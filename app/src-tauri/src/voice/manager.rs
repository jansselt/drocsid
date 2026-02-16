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

const SAMPLE_RATE: u32 = 48000;
const NUM_CHANNELS: u32 = 1;
// Ring buffer: 200ms at 48kHz mono for mic, 200ms at 48kHz stereo for output
const MIC_RING_SIZE: usize = (SAMPLE_RATE as usize) / 5;
const OUTPUT_RING_SIZE: usize = (SAMPLE_RATE as usize) * 2 / 5;

pub struct VoiceManager {
    room: Room,
    _input_stream: cpal::Stream,
    _output_stream: cpal::Stream,
    mic_muted: Arc<AtomicBool>,
    deaf: Arc<AtomicBool>,
    shutdown_tx: mpsc::Sender<()>,
    /// Per-user volume (0.0-2.0). Protected by tokio Mutex since only accessed from async tasks.
    user_volumes: Arc<Mutex<HashMap<String, f32>>>,
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
        // 1. Connect to LiveKit room
        let (room, event_rx) = Room::connect(url, token, RoomOptions::default())
            .await
            .map_err(|e| format!("Room connect failed: {e}"))?;

        // 2. Create native audio source for mic publishing
        let audio_source = NativeAudioSource::new(
            Default::default(),
            SAMPLE_RATE,
            NUM_CHANNELS,
            200, // queue_size_ms
        );

        // 3. Create and publish local audio track
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
            .map_err(|e| format!("Publish track failed: {e}"))?;

        // 4. Set up ring buffers (lock-free SPSC)
        let (mic_producer, mic_consumer) = rtrb::RingBuffer::new(MIC_RING_SIZE);
        let (output_producer, output_consumer) = rtrb::RingBuffer::new(OUTPUT_RING_SIZE);

        // 5. Build cpal streams
        let input_stream =
            audio_io::build_input_stream(mic_device_id, mic_producer)?;
        let output_stream =
            audio_io::build_output_stream(speaker_device_id, output_consumer)?;

        // 6. Shared state
        let mic_muted = Arc::new(AtomicBool::new(false));
        let deaf = Arc::new(AtomicBool::new(false));
        let user_volumes: Arc<Mutex<HashMap<String, f32>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);

        // 7. Spawn mic forwarder task
        Self::spawn_mic_forwarder(
            mic_consumer,
            audio_source,
            mic_muted.clone(),
            shutdown_rx,
        );

        // 8. Spawn room event handler + audio mixer
        let remote_streams: Arc<Mutex<HashMap<String, NativeAudioStream>>> =
            Arc::new(Mutex::new(HashMap::new()));

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
        );

        Ok(VoiceManager {
            room,
            _input_stream: input_stream,
            _output_stream: output_stream,
            mic_muted,
            deaf,
            shutdown_tx,
            user_volumes,
        })
    }

    pub async fn disconnect(self) {
        let _ = self.shutdown_tx.send(()).await;
        let _ = self.room.close().await;
        // cpal streams are dropped here, stopping audio callbacks
    }

    pub fn set_mute(&self, muted: bool) {
        self.mic_muted.store(muted, Ordering::Relaxed);
    }

    pub fn set_deaf(&self, deaf: bool) {
        self.deaf.store(deaf, Ordering::Relaxed);
    }

    pub async fn set_user_volume(&self, identity: &str, volume_percent: u32) {
        let volume = (volume_percent as f32) / 100.0;
        self.user_volumes
            .lock()
            .await
            .insert(identity.to_string(), volume);
    }

    // -- Internal tasks --

    fn spawn_mic_forwarder(
        mut consumer: rtrb::Consumer<i16>,
        audio_source: NativeAudioSource,
        mic_muted: Arc<AtomicBool>,
        mut shutdown_rx: mpsc::Receiver<()>,
    ) {
        tokio::spawn(async move {
            let mut interval =
                tokio::time::interval(std::time::Duration::from_millis(10));
            let mut buf = Vec::with_capacity(480); // 10ms at 48kHz mono

            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        if mic_muted.load(Ordering::Relaxed) {
                            // Drain the ring buffer but don't send
                            while consumer.pop().is_ok() {}
                            continue;
                        }

                        buf.clear();
                        while let Ok(sample) = consumer.pop() {
                            buf.push(sample);
                        }

                        if buf.is_empty() {
                            continue;
                        }

                        let frame = AudioFrame {
                            data: Cow::Borrowed(&buf),
                            sample_rate: SAMPLE_RATE,
                            num_channels: NUM_CHANNELS,
                            samples_per_channel: buf.len() as u32,
                        };
                        let _ = audio_source.capture_frame(&frame).await;
                    }
                    _ = shutdown_rx.recv() => break,
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
                            let stream = NativeAudioStream::new(
                                audio_track.rtc_track(),
                                SAMPLE_RATE as i32,
                                NUM_CHANNELS as i32,
                            );
                            let identity = participant.identity().to_string();
                            remote_streams
                                .lock()
                                .await
                                .insert(identity, stream);
                        }
                    }
                    RoomEvent::TrackUnsubscribed {
                        track,
                        participant,
                        ..
                    } => {
                        if matches!(track, RemoteTrack::Audio(_)) {
                            let identity = participant.identity().to_string();
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
                        let _ = app.emit(
                            "voice:participant-joined",
                            ParticipantPayload {
                                identity: participant.identity().to_string(),
                                name: Some(participant.name().to_string()),
                            },
                        );
                    }
                    RoomEvent::ParticipantDisconnected(participant) => {
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
        });
    }

    fn spawn_audio_mixer(
        remote_streams: Arc<Mutex<HashMap<String, NativeAudioStream>>>,
        mut output_producer: Producer<i16>,
        user_volumes: Arc<Mutex<HashMap<String, f32>>>,
        deaf: Arc<AtomicBool>,
    ) {
        tokio::spawn(async move {
            let mut interval =
                tokio::time::interval(std::time::Duration::from_millis(10));
            // Temporary buffer for mixing (stereo, 10ms at 48kHz = 960 samples)
            let mut mix_buf = vec![0i32; 960];

            loop {
                interval.tick().await;

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
                    for &sample in &mix_buf {
                        let clamped = sample.clamp(-32768, 32767) as i16;
                        let _ = output_producer.push(clamped);
                    }
                }
            }
        });
    }
}
