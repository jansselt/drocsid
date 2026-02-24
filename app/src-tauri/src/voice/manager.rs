use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use futures_util::{FutureExt, StreamExt};
use livekit::options::TrackPublishOptions;
use livekit::prelude::*;
use livekit::webrtc::audio_frame::AudioFrame;
use livekit::webrtc::audio_source::native::NativeAudioSource;
use livekit::webrtc::audio_source::RtcAudioSource;
use livekit::webrtc::audio_stream::native::NativeAudioStream;
use rtrb::Producer;
use serde::Serialize;
use tauri::Emitter;
use tokio::sync::{mpsc, Mutex};

use super::audio_io;
use super::suppressor;

const SAMPLE_RATE: u32 = 48000;
const NUM_CHANNELS: u32 = 1;
// Ring buffer: 200ms at 48kHz mono for mic, 200ms at 48kHz stereo for output
const MIC_RING_SIZE: usize = (SAMPLE_RATE as usize) / 5;
const OUTPUT_RING_SIZE: usize = (SAMPLE_RATE as usize) * 2 / 5;

pub struct VoiceManager {
    room: Room,
    input_stream: cpal::Stream,
    output_stream: cpal::Stream,
    mic_muted: Arc<AtomicBool>,
    deaf: Arc<AtomicBool>,
    noise_suppression: Arc<AtomicBool>,
    shutdown_tx: mpsc::Sender<()>,
    /// Per-user volume (0.0-2.0). Protected by tokio Mutex since only accessed from async tasks.
    user_volumes: Arc<Mutex<HashMap<String, f32>>>,
    /// Channel to send a replacement mic ring-buffer consumer to the forwarder task.
    mic_swap_tx: mpsc::Sender<rtrb::Consumer<i16>>,
    /// Channel to send a replacement output ring-buffer producer to the mixer task.
    output_swap_tx: mpsc::Sender<rtrb::Producer<i16>>,
    /// Active audio share state (if sharing app audio)
    #[cfg(target_os = "linux")]
    audio_share: Option<AudioShareState>,
}

/// State for an active audio share session.
#[cfg(target_os = "linux")]
struct AudioShareState {
    /// PulseAudio module ID for the null-sink (for cleanup via pactl unload-module)
    null_sink_module_id: u32,
    /// The cpal input stream capturing the null-sink's monitor
    _capture_stream: cpal::Stream,
    /// Signal to stop the audio share forwarder task
    shutdown_tx: mpsc::Sender<()>,
    /// Whether this is system-wide mode (auto-links new apps)
    system_mode: bool,
    /// The null-sink name (for the periodic monitor to find it)
    sink_name: String,
}

// -- Tauri event payloads --

#[derive(Serialize, Clone)]
struct ActiveSpeakersPayload {
    speakers: Vec<String>,
}

#[derive(Serialize, Clone)]
struct ParticipantPayload {
    identity: String,
    name: Option<String>,
}

#[derive(Serialize, Clone)]
struct ConnectionStatePayload {
    state: String,
}

#[derive(Serialize, Clone)]
struct TrackMutePayload {
    identity: String,
    muted: bool,
}

impl VoiceManager {
    pub async fn connect(
        app: tauri::AppHandle,
        url: &str,
        token: &str,
        mic_device_id: Option<&str>,
        speaker_device_id: Option<&str>,
    ) -> Result<Self, String> {
        log::info!("VoiceManager::connect: url={url}");

        // 1. Connect to LiveKit room FIRST — let libwebrtc fully initialize its
        //    WebRtcVoiceEngine and WASAPI ADM before cpal opens audio devices.
        //    On Windows, having cpal WASAPI streams open while libwebrtc creates
        //    data channels can cause a native C++ abort in libwebrtc.
        log::info!("  step 1: connecting to LiveKit room...");
        let (room, event_rx) = Room::connect(url, token, RoomOptions::default())
            .await
            .map_err(|e| {
                log::error!("  Room::connect failed: {e}");
                format!("Room connect failed: {e}")
            })?;
        log::info!("  step 1: room connected OK");

        // Emit local identity so frontend can track self-speaking
        let local_identity = room.local_participant().identity().to_string();
        log::info!("  local identity: {local_identity}");
        let _ = app.emit("voice:local-identity", &local_identity);

        // 2. Create native audio source for mic publishing
        log::info!("  step 2: creating NativeAudioSource (rate={SAMPLE_RATE}, ch={NUM_CHANNELS})");
        let audio_source = NativeAudioSource::new(
            Default::default(),
            SAMPLE_RATE,
            NUM_CHANNELS,
            200, // queue_size_ms
        );

        // 3. Create and publish local audio track
        log::info!("  step 3: publishing audio track...");
        let local_track = LocalAudioTrack::create_audio_track(
            "microphone",
            RtcAudioSource::Native(audio_source.clone()),
        );
        room.local_participant()
            .publish_track(
                LocalTrack::Audio(local_track),
                TrackPublishOptions::default(),
            )
            .await
            .map_err(|e| {
                log::error!("  publish_track failed: {e}");
                format!("Publish track failed: {e}")
            })?;
        log::info!("  step 3: track published OK");

        // 4. Give libwebrtc time to complete publisher negotiation (data channel
        //    creation, ICE gathering, DTLS setup).  On Windows, the ADM opens
        //    WASAPI devices during this phase and building cpal streams too early
        //    can trigger a C++ abort.  500ms is enough for the critical phase.
        log::info!("  step 4: waiting for WebRTC negotiation to settle...");
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        log::info!("  step 4: settle delay complete");

        // 5. Build cpal streams AFTER libwebrtc is fully initialized.
        log::info!("  step 5: setting up ring buffers and cpal streams");
        let (mic_producer, mic_consumer) = rtrb::RingBuffer::new(MIC_RING_SIZE);
        let (output_producer, output_consumer) = rtrb::RingBuffer::new(OUTPUT_RING_SIZE);

        log::info!("  step 5a: building cpal input stream (mic={mic_device_id:?})...");
        let input_stream =
            audio_io::build_input_stream(mic_device_id, mic_producer)?;
        log::info!("  step 5a: input stream OK");

        log::info!("  step 5b: building cpal output stream (speaker={speaker_device_id:?})...");
        let output_stream =
            audio_io::build_output_stream(speaker_device_id, output_consumer)?;
        log::info!("  step 5b: output stream OK");

        // 6. Shared state
        let mic_muted = Arc::new(AtomicBool::new(false));
        let deaf = Arc::new(AtomicBool::new(false));
        let noise_suppression = Arc::new(AtomicBool::new(true));
        let user_volumes: Arc<Mutex<HashMap<String, f32>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);

        // Channels for hot-swapping audio devices while connected
        let (mic_swap_tx, mic_swap_rx) = mpsc::channel::<rtrb::Consumer<i16>>(4);
        let (output_swap_tx, output_swap_rx) = mpsc::channel::<rtrb::Producer<i16>>(4);

        // 7. Spawn mic forwarder task
        log::info!("  step 7: spawning mic forwarder task");
        Self::spawn_mic_forwarder(
            app.clone(),
            mic_consumer,
            audio_source,
            mic_muted.clone(),
            noise_suppression.clone(),
            shutdown_rx,
            mic_swap_rx,
        );

        // 8. Spawn room event handler + audio mixer
        let remote_streams: Arc<Mutex<HashMap<String, NativeAudioStream>>> =
            Arc::new(Mutex::new(HashMap::new()));

        log::info!("  step 8: spawning event handler + audio mixer");
        Self::spawn_event_handler(
            app,
            event_rx,
            remote_streams.clone(),
        );

        Self::spawn_audio_mixer(
            remote_streams,
            output_producer,
            user_volumes.clone(),
            deaf.clone(),
            output_swap_rx,
        );

        log::info!("VoiceManager::connect: all steps complete, voice active");
        Ok(VoiceManager {
            room,
            input_stream,
            output_stream,
            mic_muted,
            deaf,
            noise_suppression,
            shutdown_tx,
            user_volumes,
            mic_swap_tx,
            output_swap_tx,
            #[cfg(target_os = "linux")]
            audio_share: None,
        })
    }

    pub async fn disconnect(mut self) {
        log::info!("VoiceManager::disconnect");
        // Stop audio sharing if active
        #[cfg(target_os = "linux")]
        {
            if self.audio_share.is_some() {
                let _ = self.stop_audio_share().await;
            }
        }
        let _ = self.shutdown_tx.send(()).await;
        let _ = self.room.close().await;
        log::info!("VoiceManager::disconnect: done, streams dropped");
        // cpal streams are dropped here, stopping audio callbacks
    }

    pub fn set_mute(&self, muted: bool) {
        self.mic_muted.store(muted, Ordering::Relaxed);
    }

    pub fn set_deaf(&self, deaf: bool) {
        self.deaf.store(deaf, Ordering::Relaxed);
    }

    pub fn set_noise_suppression(&self, enabled: bool) {
        self.noise_suppression.store(enabled, Ordering::Relaxed);
    }

    pub async fn set_user_volume(&self, identity: &str, volume_percent: u32) {
        let volume = (volume_percent as f32) / 100.0;
        self.user_volumes
            .lock()
            .await
            .insert(identity.to_string(), volume);
    }

    /// Hot-swap the input (microphone) device while keeping the LiveKit connection alive.
    pub fn set_input_device(&mut self, device_id: Option<&str>) -> Result<(), String> {
        log::info!("VoiceManager::set_input_device: {device_id:?}");
        let (producer, consumer) = rtrb::RingBuffer::new(MIC_RING_SIZE);
        let new_stream = audio_io::build_input_stream(device_id, producer)?;
        // Send new consumer to the forwarder task (it will swap on next tick)
        self.mic_swap_tx.try_send(consumer).map_err(|e| {
            log::error!("set_input_device: failed to send new consumer: {e}");
            format!("Failed to swap mic consumer: {e}")
        })?;
        // Replace stream — old one drops here, stopping its cpal callback
        self.input_stream = new_stream;
        log::info!("VoiceManager::set_input_device: swap complete");
        Ok(())
    }

    /// Hot-swap the output (speaker) device while keeping the LiveKit connection alive.
    pub fn set_output_device(&mut self, device_id: Option<&str>) -> Result<(), String> {
        log::info!("VoiceManager::set_output_device: {device_id:?}");
        let (producer, consumer) = rtrb::RingBuffer::new(OUTPUT_RING_SIZE);
        let new_stream = audio_io::build_output_stream(device_id, consumer)?;
        // Send new producer to the mixer task (it will swap on next tick)
        self.output_swap_tx.try_send(producer).map_err(|e| {
            log::error!("set_output_device: failed to send new producer: {e}");
            format!("Failed to swap output producer: {e}")
        })?;
        // Replace stream — old one drops here, stopping its cpal callback
        self.output_stream = new_stream;
        log::info!("VoiceManager::set_output_device: swap complete");
        Ok(())
    }

    // -- Audio sharing (Linux/PipeWire) --

    /// Start sharing application audio via a PipeWire null-sink monitor.
    /// `target_node_ids`: PipeWire node IDs to capture. If `system_mode` is true,
    /// the periodic monitor will auto-link newly-appearing non-drocsid apps.
    #[cfg(target_os = "linux")]
    pub async fn start_audio_share(
        &mut self,
        app_handle: tauri::AppHandle,
        target_node_ids: Vec<u64>,
        system_mode: bool,
    ) -> Result<(), String> {
        // Stop existing audio share if any
        if self.audio_share.is_some() {
            self.stop_audio_share().await?;
        }

        let sink_name = format!(
            "drocsid_audioshare_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        );
        log::info!("start_audio_share: creating null-sink {sink_name} for {} targets (system_mode={system_mode})",
            target_node_ids.len());

        // 1. Create null-sink
        let module_id = crate::audio::create_null_sink(&sink_name)?;
        log::info!("start_audio_share: null-sink module_id={module_id}");

        // 2. Wait for PipeWire to register it
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;

        // 3. Find null-sink in PipeWire and link target apps to it
        let objects = crate::audio::pw_dump_all()?;
        let null_sink_node_id = crate::audio::find_node_by_name(&objects, &sink_name)
            .ok_or_else(|| "Null-sink node not found in PipeWire after creation".to_string())?;

        for &target_id in &target_node_ids {
            match crate::audio::link_app_to_null_sink(&objects, target_id, null_sink_node_id) {
                Ok(n) => log::info!("start_audio_share: linked node {target_id} -> null-sink ({n} links)"),
                Err(e) => log::warn!("start_audio_share: failed to link node {target_id}: {e}"),
            }
        }

        // 4. Create second NativeAudioSource for the share track (stereo)
        let share_source = NativeAudioSource::new(
            Default::default(),
            SAMPLE_RATE,
            2, // stereo
            200,
        );

        // 5. Publish as ScreenShareAudio track
        let share_track = LocalAudioTrack::create_audio_track(
            "audio-share",
            RtcAudioSource::Native(share_source.clone()),
        );
        self.room
            .local_participant()
            .publish_track(
                LocalTrack::Audio(share_track),
                TrackPublishOptions {
                    source: TrackSource::ScreenshareAudio,
                    ..Default::default()
                },
            )
            .await
            .map_err(|e| format!("Publish audio share track failed: {e}"))?;
        log::info!("start_audio_share: published ScreenShareAudio track");

        // 6. Open cpal stereo input on the null-sink monitor
        let monitor_name = format!("{sink_name}.monitor");
        let stereo_ring_size = (SAMPLE_RATE as usize) * 2 / 5; // 200ms stereo
        let (producer, consumer) = rtrb::RingBuffer::new(stereo_ring_size);
        let capture_stream = audio_io::build_stereo_input_stream(Some(&monitor_name), producer)?;

        // 7. Spawn audio share forwarder task
        let (share_shutdown_tx, share_shutdown_rx) = mpsc::channel::<()>(1);
        Self::spawn_audio_share_forwarder(consumer, share_source, share_shutdown_rx);

        // 8. Spawn periodic PipeWire monitor for auto-linking (system mode) or cleanup (per-app)
        let monitor_sink_name = sink_name.clone();
        let monitor_target_ids = target_node_ids.clone();
        let monitor_shutdown = share_shutdown_tx.clone();
        let app_for_monitor = self.room.local_participant().identity().to_string();
        let monitor_app_handle = app_handle;
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));
            loop {
                interval.tick().await;
                if monitor_shutdown.is_closed() {
                    break;
                }

                let objects = match crate::audio::pw_dump_all() {
                    Ok(o) => o,
                    Err(_) => continue,
                };

                if system_mode {
                    // Auto-link new non-drocsid apps to the null-sink
                    let our_pid = std::process::id();
                    let child_pids = crate::audio::get_descendant_pids(our_pid);

                    let null_sink_node_id = match crate::audio::find_node_by_name(&objects, &monitor_sink_name) {
                        Some(id) => id,
                        None => continue, // null-sink gone, probably stopping
                    };

                    for obj in &objects {
                        if obj.get("type").and_then(|t| t.as_str()) != Some("PipeWire:Interface:Node") {
                            continue;
                        }
                        let props = match obj.pointer("/info/props") {
                            Some(p) => p,
                            None => continue,
                        };
                        if props.get("media.class").and_then(|v| v.as_str()) != Some("Stream/Output/Audio") {
                            continue;
                        }
                        if let Some(pid) = crate::audio::get_pid_from_props(props) {
                            if pid == our_pid || child_pids.contains(&pid) {
                                continue;
                            }
                        }
                        if let Some(node_id) = obj.get("id").and_then(|v| v.as_u64()) {
                            // Check if already linked to our null-sink
                            let sink_input_ports = crate::audio::find_node_ports(&objects, null_sink_node_id, "input");
                            let app_output_ports = crate::audio::find_node_ports(&objects, node_id, "output");
                            // Simple check: if the app has output ports and the null-sink has input ports, try linking
                            // pw-link will no-op if link already exists
                            if !app_output_ports.is_empty() && !sink_input_ports.is_empty() {
                                let _ = crate::audio::link_app_to_null_sink(&objects, node_id, null_sink_node_id);
                            }
                        }
                    }
                } else {
                    // Per-app mode: check if target node(s) still exist
                    let all_gone = monitor_target_ids.iter().all(|&target_id| {
                        !objects.iter().any(|obj| {
                            obj.get("id").and_then(|v| v.as_u64()) == Some(target_id)
                                && obj.get("type").and_then(|t| t.as_str())
                                    == Some("PipeWire:Interface:Node")
                        })
                    });
                    if all_gone {
                        log::info!("audio_share_monitor: all target nodes gone, emitting event");
                        let _ = monitor_app_handle.emit("voice:audio-share-ended", ());
                        break;
                    }
                }
            }
            log::info!("audio_share_monitor: exiting (identity={})", app_for_monitor);
        });

        self.audio_share = Some(AudioShareState {
            null_sink_module_id: module_id,
            _capture_stream: capture_stream,
            shutdown_tx: share_shutdown_tx,
            system_mode,
            sink_name,
        });

        log::info!("start_audio_share: complete");
        Ok(())
    }

    /// Stop sharing application audio. Cleans up null-sink, unpublishes track.
    #[cfg(target_os = "linux")]
    pub async fn stop_audio_share(&mut self) -> Result<(), String> {
        if let Some(state) = self.audio_share.take() {
            log::info!("stop_audio_share: cleaning up null-sink module_id={}", state.null_sink_module_id);

            // 1. Signal forwarder + monitor to stop
            let _ = state.shutdown_tx.send(()).await;

            // 2. Unpublish the audio share track
            for pub_ in self.room.local_participant().track_publications().values() {
                if pub_.source() == TrackSource::ScreenshareAudio {
                    let sid = pub_.sid();
                    let _ = self.room.local_participant().unpublish_track(&sid).await;
                }
            }

            // 3. Destroy null-sink (PipeWire auto-removes all its links)
            crate::audio::destroy_null_sink(state.null_sink_module_id);

            // 4. cpal capture_stream is dropped here
            log::info!("stop_audio_share: cleanup complete");
        }
        Ok(())
    }

    // -- Internal tasks --

    /// Forwarder task for audio share: reads stereo samples from ring buffer and pushes to LiveKit.
    #[cfg(target_os = "linux")]
    fn spawn_audio_share_forwarder(
        mut consumer: rtrb::Consumer<i16>,
        audio_source: NativeAudioSource,
        mut shutdown_rx: mpsc::Receiver<()>,
    ) {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_millis(10));
            let mut buf = Vec::with_capacity(960); // 10ms at 48kHz stereo

            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        buf.clear();
                        while let Ok(sample) = consumer.pop() {
                            buf.push(sample);
                        }
                        if buf.is_empty() {
                            continue;
                        }

                        let samples_per_channel = (buf.len() / 2) as u32;
                        let frame = AudioFrame {
                            data: Cow::Borrowed(&buf),
                            sample_rate: SAMPLE_RATE,
                            num_channels: 2,
                            samples_per_channel,
                        };
                        let _ = audio_source.capture_frame(&frame).await;
                    }
                    _ = shutdown_rx.recv() => {
                        log::info!("audio_share_forwarder: shutdown received");
                        break;
                    },
                }
            }
        });
    }

    fn spawn_mic_forwarder(
        app: tauri::AppHandle,
        mut consumer: rtrb::Consumer<i16>,
        audio_source: NativeAudioSource,
        mic_muted: Arc<AtomicBool>,
        noise_suppression: Arc<AtomicBool>,
        mut shutdown_rx: mpsc::Receiver<()>,
        mut swap_rx: mpsc::Receiver<rtrb::Consumer<i16>>,
    ) {
        tokio::spawn(async move {
            let mut interval =
                tokio::time::interval(std::time::Duration::from_millis(10));
            let mut buf = Vec::with_capacity(480); // 10ms at 48kHz mono
            let mut first_samples_logged = false;
            let mut empty_ticks: u64 = 0;

            // Noise suppression state
            let mut denoiser = suppressor::create_default_suppressor();
            let ns_frame_size = denoiser.frame_size();
            let mut ns_in = vec![0.0f32; ns_frame_size];
            let mut ns_out = vec![0.0f32; ns_frame_size];

            // Periodic diagnostic counters
            let mut diag_ticks: u64 = 0;
            let mut diag_samples_total: u64 = 0;
            let mut diag_frames_captured: u64 = 0;
            let mut diag_capture_errors: u64 = 0;

            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        // Check for a device-swap message (non-blocking)
                        while let Ok(new_consumer) = swap_rx.try_recv() {
                            log::info!("mic_forwarder: swapping to new input consumer");
                            consumer = new_consumer;
                            first_samples_logged = false;
                            empty_ticks = 0;
                        }

                        diag_ticks += 1;

                        // Log diagnostics every 1 second (100 ticks × 10ms)
                        if diag_ticks % 100 == 0 {
                            log::info!(
                                "mic_forwarder [{}s]: samples_total={}, frames_captured={}, capture_errors={}, empty_ticks={}",
                                diag_ticks / 100,
                                diag_samples_total,
                                diag_frames_captured,
                                diag_capture_errors,
                                empty_ticks,
                            );
                        }

                        if mic_muted.load(Ordering::Relaxed) {
                            // Drain the ring buffer but don't send
                            while consumer.pop().is_ok() {}
                            let _ = app.emit("voice:mic-level", 0.0_f64);
                            continue;
                        }

                        buf.clear();
                        while let Ok(sample) = consumer.pop() {
                            buf.push(sample);
                        }

                        if buf.is_empty() {
                            empty_ticks += 1;
                            // Log a warning if we've been getting no samples for a while
                            if empty_ticks == 100 {
                                log::warn!("mic_forwarder: no samples received for 1 second — cpal input stream may not be producing data");
                            }
                            continue;
                        }

                        if !first_samples_logged {
                            log::info!("mic_forwarder: first {} samples received from cpal input", buf.len());
                            first_samples_logged = true;
                        }
                        empty_ticks = 0;
                        diag_samples_total += buf.len() as u64;

                        // Apply noise suppression if enabled (process complete frames)
                        if noise_suppression.load(Ordering::Relaxed) {
                            let mut i = 0;
                            while i + ns_frame_size <= buf.len() {
                                for j in 0..ns_frame_size {
                                    ns_in[j] = buf[i + j] as f32;
                                }
                                denoiser.process_frame(&ns_in, &mut ns_out);
                                for j in 0..ns_frame_size {
                                    buf[i + j] = ns_out[j].clamp(-32768.0, 32767.0) as i16;
                                }
                                i += ns_frame_size;
                            }
                            // Remaining samples (< frame_size) pass through unprocessed.
                        }

                        // Compute RMS level for local speaking indicator (after NS for accuracy)
                        let sum_sq: f64 = buf.iter().map(|&s| {
                            let f = s as f64 / i16::MAX as f64;
                            f * f
                        }).sum();
                        let rms = (sum_sq / buf.len() as f64).sqrt();
                        let level = (rms * 600.0).min(100.0);
                        let _ = app.emit("voice:mic-level", level);

                        let frame = AudioFrame {
                            data: Cow::Borrowed(&buf),
                            sample_rate: SAMPLE_RATE,
                            num_channels: NUM_CHANNELS,
                            samples_per_channel: buf.len() as u32,
                        };
                        match audio_source.capture_frame(&frame).await {
                            Ok(()) => { diag_frames_captured += 1; }
                            Err(e) => {
                                diag_capture_errors += 1;
                                if diag_capture_errors <= 5 {
                                    log::error!("mic_forwarder: capture_frame error: {e}");
                                }
                            }
                        }
                    }
                    _ = shutdown_rx.recv() => {
                        log::info!("mic_forwarder: shutdown received");
                        break;
                    },
                }
            }
        });
    }

    fn spawn_event_handler(
        app: tauri::AppHandle,
        mut event_rx: mpsc::UnboundedReceiver<RoomEvent>,
        remote_streams: Arc<Mutex<HashMap<String, NativeAudioStream>>>,
    ) {
        tokio::spawn(async move {
            while let Some(event) = event_rx.recv().await {
                match event {
                    RoomEvent::TrackSubscribed {
                        track,
                        participant,
                        ..
                    } => {
                        if let RemoteTrack::Audio(audio_track) = track {
                            let identity = participant.identity().to_string();
                            log::info!("event: TrackSubscribed (audio) from {identity}");
                            let stream = NativeAudioStream::new(
                                audio_track.rtc_track(),
                                SAMPLE_RATE as i32,
                                NUM_CHANNELS as i32,
                            );
                            remote_streams
                                .lock()
                                .await
                                .insert(identity, stream);
                            let count = remote_streams.lock().await.len();
                            log::info!("event: remote_streams count now = {count}");
                        }
                    }
                    RoomEvent::TrackUnsubscribed {
                        track,
                        participant,
                        ..
                    } => {
                        if matches!(track, RemoteTrack::Audio(_)) {
                            let identity = participant.identity().to_string();
                            log::info!("event: TrackUnsubscribed (audio) from {identity}");
                            if let Some(mut stream) =
                                remote_streams.lock().await.remove(&identity)
                            {
                                stream.close();
                            }
                        }
                    }
                    RoomEvent::ActiveSpeakersChanged { speakers } => {
                        let identities: Vec<String> = speakers
                            .iter()
                            .map(|p| p.identity().to_string())
                            .collect();
                        let _ = app.emit(
                            "voice:active-speakers",
                            ActiveSpeakersPayload {
                                speakers: identities,
                            },
                        );
                    }
                    RoomEvent::ParticipantConnected(participant) => {
                        log::info!("event: ParticipantConnected: {}", participant.identity());
                        let _ = app.emit(
                            "voice:participant-joined",
                            ParticipantPayload {
                                identity: participant.identity().to_string(),
                                name: Some(participant.name().to_string()),
                            },
                        );
                    }
                    RoomEvent::ParticipantDisconnected(participant) => {
                        log::info!("event: ParticipantDisconnected: {}", participant.identity());
                        let _ = app.emit(
                            "voice:participant-left",
                            ParticipantPayload {
                                identity: participant.identity().to_string(),
                                name: None,
                            },
                        );
                    }
                    RoomEvent::ConnectionStateChanged(state) => {
                        let state_str = match state {
                            ConnectionState::Connected => "connected",
                            ConnectionState::Reconnecting => "reconnecting",
                            ConnectionState::Disconnected => "disconnected",
                        };
                        log::info!("event: ConnectionStateChanged → {state_str}");
                        let _ = app.emit(
                            "voice:connection-state",
                            ConnectionStatePayload {
                                state: state_str.to_string(),
                            },
                        );
                    }
                    RoomEvent::TrackMuted {
                        participant,
                        ..
                    } => {
                        let _ = app.emit(
                            "voice:track-muted",
                            TrackMutePayload {
                                identity: participant.identity().to_string(),
                                muted: true,
                            },
                        );
                    }
                    RoomEvent::TrackUnmuted {
                        participant,
                        ..
                    } => {
                        let _ = app.emit(
                            "voice:track-muted",
                            TrackMutePayload {
                                identity: participant.identity().to_string(),
                                muted: false,
                            },
                        );
                    }
                    _ => {}
                }
            }
            log::info!("event_handler: room event channel closed");
        });
    }

    fn spawn_audio_mixer(
        remote_streams: Arc<Mutex<HashMap<String, NativeAudioStream>>>,
        mut output_producer: Producer<i16>,
        user_volumes: Arc<Mutex<HashMap<String, f32>>>,
        deaf: Arc<AtomicBool>,
        mut swap_rx: mpsc::Receiver<rtrb::Producer<i16>>,
    ) {
        tokio::spawn(async move {
            let mut interval =
                tokio::time::interval(std::time::Duration::from_millis(10));
            // Temporary buffer for mixing (stereo, 10ms at 48kHz = 960 samples)
            let mut mix_buf = vec![0i32; 960];
            let mut first_audio_logged = false;

            // Periodic diagnostic counters
            let mut diag_ticks: u64 = 0;
            let mut diag_frames_received: u64 = 0;
            let mut diag_samples_written: u64 = 0;
            let mut diag_ticks_with_audio: u64 = 0;

            loop {
                interval.tick().await;

                // Check for a device-swap message (non-blocking)
                while let Ok(new_producer) = swap_rx.try_recv() {
                    log::info!("audio_mixer: swapping to new output producer");
                    output_producer = new_producer;
                }

                diag_ticks += 1;

                // Log diagnostics every 1 second (100 ticks × 10ms)
                if diag_ticks % 100 == 0 {
                    let stream_count = remote_streams.lock().await.len();
                    log::info!(
                        "audio_mixer [{}s]: streams={}, frames_received={}, samples_written={}, ticks_with_audio={}",
                        diag_ticks / 100,
                        stream_count,
                        diag_frames_received,
                        diag_samples_written,
                        diag_ticks_with_audio,
                    );
                }

                if deaf.load(Ordering::Relaxed) {
                    // Push silence
                    for _ in 0..960 {
                        let _ = output_producer.push(0i16);
                    }
                    continue;
                }

                // Zero the mix buffer
                mix_buf.iter_mut().for_each(|s| *s = 0);
                let mut has_audio = false;

                let mut streams = remote_streams.lock().await;
                let volumes = user_volumes.lock().await;

                for (identity, stream) in streams.iter_mut() {
                    let volume = volumes.get(identity).copied().unwrap_or(1.0);
                    // Try to get available frames (non-blocking poll)
                    while let Some(frame) = stream.next().now_or_never().flatten()
                    {
                        has_audio = true;
                        diag_frames_received += 1;
                        // Mix mono frame into stereo output
                        for (i, &sample) in frame.data.iter().enumerate() {
                            let scaled: i32 = (sample as f32 * volume) as i32;
                            let out_l = i * 2;
                            let out_r = i * 2 + 1;
                            if out_r < mix_buf.len() {
                                mix_buf[out_l] = mix_buf[out_l].saturating_add(scaled);
                                mix_buf[out_r] = mix_buf[out_r].saturating_add(scaled);
                            }
                        }
                    }
                }

                drop(volumes);
                drop(streams);

                if has_audio {
                    diag_ticks_with_audio += 1;
                    if !first_audio_logged {
                        log::info!("audio_mixer: first remote audio received and mixed to output");
                        first_audio_logged = true;
                    }
                    for &sample in &mix_buf {
                        let clamped = sample.clamp(-32768, 32767) as i16;
                        let _ = output_producer.push(clamped);
                    }
                    diag_samples_written += mix_buf.len() as u64;
                }
            }
        });
    }
}
