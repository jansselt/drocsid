use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rtrb::{Consumer, Producer};
use serde::Serialize;
use tauri::Emitter;

#[derive(Serialize, Clone, Debug)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

// ===========================================================================
// Platform-specific device enumeration & targeting
// ===========================================================================

// ---------------------------------------------------------------------------
// Linux: PipeWire-native device enumeration via pactl
// ---------------------------------------------------------------------------
#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use serde::Deserialize;
    use std::process::Command;
    use std::sync::Mutex as StdMutex;

    /// Minimal struct for deserializing `pactl --format=json list sources/sinks`.
    #[derive(Deserialize)]
    struct PaDevice {
        name: String,
        description: String,
    }

    fn pactl_get_default(kind: &str) -> Option<String> {
        let output = Command::new("pactl")
            .arg(format!("get-default-{kind}"))
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let s = String::from_utf8(output.stdout).ok()?;
        Some(s.trim().to_string())
    }

    pub fn list_input_devices() -> Result<Vec<AudioDevice>, String> {
        let output = Command::new("pactl")
            .args(["--format=json", "list", "sources"])
            .output()
            .map_err(|e| format!("Failed to run pactl: {e}"))?;

        if !output.status.success() {
            return Err("pactl list sources failed".into());
        }

        let sources: Vec<PaDevice> = serde_json::from_slice(&output.stdout)
            .map_err(|e| format!("Failed to parse pactl output: {e}"))?;

        let default_name = pactl_get_default("source");

        Ok(sources
            .into_iter()
            // Filter out monitor sources (they capture output audio, not mic input)
            .filter(|s| !s.name.contains(".monitor"))
            .map(|s| {
                let is_default = default_name.as_deref() == Some(&s.name);
                AudioDevice {
                    id: s.name,
                    name: s.description,
                    is_default,
                }
            })
            .collect())
    }

    pub fn list_output_devices() -> Result<Vec<AudioDevice>, String> {
        let output = Command::new("pactl")
            .args(["--format=json", "list", "sinks"])
            .output()
            .map_err(|e| format!("Failed to run pactl: {e}"))?;

        if !output.status.success() {
            return Err("pactl list sinks failed".into());
        }

        let sinks: Vec<PaDevice> = serde_json::from_slice(&output.stdout)
            .map_err(|e| format!("Failed to parse pactl output: {e}"))?;

        let default_name = pactl_get_default("sink");

        Ok(sinks
            .into_iter()
            .map(|s| {
                let is_default = default_name.as_deref() == Some(&s.name);
                AudioDevice {
                    id: s.name,
                    name: s.description,
                    is_default,
                }
            })
            .collect())
    }

    // PIPEWIRE_NODE-based device targeting for cpal.
    //
    // Global lock to serialize cpal device opens with PIPEWIRE_NODE targeting.
    // PIPEWIRE_NODE is a process-global env var read by PipeWire's ALSA plugin
    // at PCM open time, so concurrent opens must be serialized.
    // The env var must remain set during the stream build call (not just device
    // enumeration), because PipeWire reads it when the ALSA PCM is opened.
    static PW_NODE_LOCK: StdMutex<()> = StdMutex::new(());

    /// Resolve input device and execute closure with PIPEWIRE_NODE set.
    /// The closure receives the cpal device while the env var is still active,
    /// so the stream build will route to the correct PipeWire node.
    pub fn with_input_device<F, T>(device_id: Option<&str>, f: F) -> Result<T, String>
    where
        F: FnOnce(cpal::Device) -> Result<T, String>,
    {
        let _lock = PW_NODE_LOCK.lock().map_err(|e| e.to_string())?;

        if let Some(name) = device_id {
            log::debug!("with_input_device: setting PIPEWIRE_NODE={name}");
            std::env::set_var("PIPEWIRE_NODE", name);
        } else {
            log::debug!("with_input_device: no device_id, using system default");
        }

        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| "No audio input device available".to_string())?;

        let result = f(device);

        std::env::remove_var("PIPEWIRE_NODE");

        result
    }

    /// Resolve output device and execute closure with PIPEWIRE_NODE set.
    pub fn with_output_device<F, T>(device_id: Option<&str>, f: F) -> Result<T, String>
    where
        F: FnOnce(cpal::Device) -> Result<T, String>,
    {
        let _lock = PW_NODE_LOCK.lock().map_err(|e| e.to_string())?;

        if let Some(name) = device_id {
            log::debug!("with_output_device: setting PIPEWIRE_NODE={name}");
            std::env::set_var("PIPEWIRE_NODE", name);
        } else {
            log::debug!("with_output_device: no device_id, using system default");
        }

        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| "No audio output device available".to_string())?;

        let result = f(device);

        std::env::remove_var("PIPEWIRE_NODE");

        result
    }
}

// ---------------------------------------------------------------------------
// Non-Linux (Windows, macOS): cpal-native device enumeration
// ---------------------------------------------------------------------------
#[cfg(not(target_os = "linux"))]
mod platform {
    use super::*;

    /// Build a human-readable device name matching the standard Windows/macOS
    /// format: "Name (Adapter)" — e.g. "Microphone (Realtek(R) Audio)".
    /// On WASAPI, manufacturer() is always None; the adapter name is in driver().
    fn display_name(device: &cpal::Device) -> Option<String> {
        let desc = device.description().ok()?;
        let adapter = desc.manufacturer()
            .filter(|s| !s.is_empty())
            .or_else(|| desc.driver())
            .filter(|s| !s.is_empty());
        match adapter {
            Some(a) => Some(format!("{} ({})", desc.name(), a)),
            None => Some(desc.name().to_string()),
        }
    }

    pub fn list_input_devices() -> Result<Vec<AudioDevice>, String> {
        let host = cpal::default_host();
        log::debug!("list_input_devices: host={:?}", host.id());
        let default_id = host
            .default_input_device()
            .and_then(|d| d.id().ok());
        log::debug!("list_input_devices: default_id={default_id:?}");

        let devices: Vec<AudioDevice> = host
            .input_devices()
            .map_err(|e| format!("Failed to enumerate input devices: {e}"))?
            .filter_map(|device| {
                let dev_id = device.id().ok()?;
                let name = display_name(&device)?;
                let is_default = default_id.as_ref() == Some(&dev_id);
                log::debug!("  input device: id={dev_id} name={name:?} default={is_default}");
                Some(AudioDevice {
                    id: dev_id.to_string(),
                    name,
                    is_default,
                })
            })
            .collect();

        Ok(devices)
    }

    pub fn list_output_devices() -> Result<Vec<AudioDevice>, String> {
        let host = cpal::default_host();
        log::debug!("list_output_devices: host={:?}", host.id());
        let default_id = host
            .default_output_device()
            .and_then(|d| d.id().ok());
        log::debug!("list_output_devices: default_id={default_id:?}");

        let devices: Vec<AudioDevice> = host
            .output_devices()
            .map_err(|e| format!("Failed to enumerate output devices: {e}"))?
            .filter_map(|device| {
                let dev_id = device.id().ok()?;
                let name = display_name(&device)?;
                let is_default = default_id.as_ref() == Some(&dev_id);
                log::debug!("  output device: id={dev_id} name={name:?} default={is_default}");
                Some(AudioDevice {
                    id: dev_id.to_string(),
                    name,
                    is_default,
                })
            })
            .collect();

        Ok(devices)
    }

    fn resolve_device_by_id(device_id: &str) -> Result<cpal::Device, String> {
        log::debug!("resolve_device_by_id: parsing '{device_id}'");
        let host = cpal::default_host();
        let id: cpal::DeviceId = device_id
            .parse()
            .map_err(|e: cpal::DeviceIdError| {
                log::error!("resolve_device_by_id: parse failed for '{device_id}': {e}");
                format!("Invalid device ID '{device_id}': {e}")
            })?;
        log::debug!("resolve_device_by_id: parsed OK, looking up in host");
        host.device_by_id(&id)
            .ok_or_else(|| {
                log::error!("resolve_device_by_id: device_by_id returned None for '{device_id}'");
                format!("Device not found: {device_id}")
            })
    }

    /// Resolve input device by stable ID and execute closure.
    pub fn with_input_device<F, T>(device_id: Option<&str>, f: F) -> Result<T, String>
    where
        F: FnOnce(cpal::Device) -> Result<T, String>,
    {
        let device = if let Some(id) = device_id {
            log::info!("with_input_device: resolving device_id={id}");
            resolve_device_by_id(id)?
        } else {
            log::info!("with_input_device: no device_id, using system default");
            cpal::default_host()
                .default_input_device()
                .ok_or_else(|| "No default input device available".to_string())?
        };
        // Log which device we got
        if let Ok(desc) = device.description() {
            log::info!("with_input_device: resolved to '{}'", desc.name());
        }
        f(device)
    }

    /// Resolve output device by stable ID and execute closure.
    pub fn with_output_device<F, T>(device_id: Option<&str>, f: F) -> Result<T, String>
    where
        F: FnOnce(cpal::Device) -> Result<T, String>,
    {
        let device = if let Some(id) = device_id {
            log::info!("with_output_device: resolving device_id={id}");
            resolve_device_by_id(id)?
        } else {
            log::info!("with_output_device: no device_id, using system default");
            cpal::default_host()
                .default_output_device()
                .ok_or_else(|| "No default output device available".to_string())?
        };
        if let Ok(desc) = device.description() {
            log::info!("with_output_device: resolved to '{}'", desc.name());
        }
        f(device)
    }
}

// Re-export platform implementations
pub use platform::{list_input_devices, list_output_devices};
use platform::{with_input_device, with_output_device};

// ===========================================================================
// Stream config negotiation (cross-platform)
// ===========================================================================
//
// On Linux (PipeWire/ALSA), mono 48 kHz is always accepted because PipeWire
// handles channel/rate conversion transparently.  On Windows (WASAPI) and
// macOS (CoreAudio), the device may only support a fixed channel count (e.g.
// stereo-only microphone).  We query the device's supported configurations
// and pick one that works, then convert in the callback.

/// Negotiate a compatible input stream config.
/// Returns (StreamConfig, native_channel_count).
fn negotiate_input_config(device: &cpal::Device) -> Result<(cpal::StreamConfig, u16), String> {
    if let Ok(supported) = device.supported_input_configs() {
        let configs: Vec<_> = supported.collect();
        for cfg in &configs {
            log::debug!(
                "  supported input: ch={} rate={}-{} fmt={:?}",
                cfg.channels(), cfg.min_sample_rate(), cfg.max_sample_rate(), cfg.sample_format()
            );
        }

        // Find configs supporting 48 kHz, prefer fewest channels (less conversion)
        let mut candidates: Vec<_> = configs.iter()
            .filter(|c| c.min_sample_rate() <= 48000 && c.max_sample_rate() >= 48000)
            .collect();
        candidates.sort_by_key(|c| c.channels());

        if let Some(cfg) = candidates.first() {
            let channels = cfg.channels();
            log::info!("negotiate_input_config: selected ch={channels} at 48kHz");
            return Ok((cpal::StreamConfig {
                channels,
                sample_rate: 48000,
                buffer_size: cpal::BufferSize::Default,
            }, channels));
        }
    }

    // Fallback: use device default config
    let default = device.default_input_config()
        .map_err(|e| format!("No compatible input config found: {e}"))?;
    let channels = default.channels();
    log::info!(
        "negotiate_input_config: fallback to default ch={channels} rate={}",
        default.sample_rate()
    );
    Ok((cpal::StreamConfig {
        channels,
        sample_rate: default.sample_rate(),
        buffer_size: cpal::BufferSize::Default,
    }, channels))
}

/// Negotiate a compatible output stream config.
/// Returns (StreamConfig, native_channel_count).
fn negotiate_output_config(device: &cpal::Device) -> Result<(cpal::StreamConfig, u16), String> {
    if let Ok(supported) = device.supported_output_configs() {
        let configs: Vec<_> = supported.collect();
        for cfg in &configs {
            log::debug!(
                "  supported output: ch={} rate={}-{} fmt={:?}",
                cfg.channels(), cfg.min_sample_rate(), cfg.max_sample_rate(), cfg.sample_format()
            );
        }

        // Find configs supporting 48 kHz, prefer >=2 channels (for stereo output)
        let mut candidates: Vec<_> = configs.iter()
            .filter(|c| c.min_sample_rate() <= 48000 && c.max_sample_rate() >= 48000)
            .collect();
        // Prefer 2 channels, then fewer
        candidates.sort_by_key(|c| {
            let ch = c.channels();
            if ch == 2 { 0u16 } else { ch }
        });

        if let Some(cfg) = candidates.first() {
            let channels = cfg.channels();
            log::info!("negotiate_output_config: selected ch={channels} at 48kHz");
            return Ok((cpal::StreamConfig {
                channels,
                sample_rate: 48000,
                buffer_size: cpal::BufferSize::Default,
            }, channels));
        }
    }

    // Fallback: use device default config
    let default = device.default_output_config()
        .map_err(|e| format!("No compatible output config found: {e}"))?;
    let channels = default.channels();
    log::info!(
        "negotiate_output_config: fallback to default ch={channels} rate={}",
        default.sample_rate()
    );
    Ok((cpal::StreamConfig {
        channels,
        sample_rate: default.sample_rate(),
        buffer_size: cpal::BufferSize::Default,
    }, channels))
}

// ===========================================================================
// Audio stream builders (cross-platform)
// ===========================================================================

/// Build a cpal input stream that pushes mono PCM samples into an rtrb ring buffer.
/// Negotiates the device's native channel count and downmixes to mono in the callback.
pub fn build_input_stream(
    device_id: Option<&str>,
    mut producer: Producer<i16>,
) -> Result<cpal::Stream, String> {
    log::info!("build_input_stream: device_id={device_id:?}");
    with_input_device(device_id, |device| {
        let (config, native_ch) = negotiate_input_config(&device)?;
        log::info!(
            "build_input_stream: negotiated ch={} rate={} (will downmix to mono)",
            config.channels, config.sample_rate
        );

        let stream = device
            .build_input_stream(
                &config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    let ch = native_ch as usize;
                    if ch <= 1 {
                        // Already mono — pass through
                        for &sample in data {
                            let _ = producer.push(sample);
                        }
                    } else {
                        // Downmix to mono: average all channels per frame
                        for frame in data.chunks(ch) {
                            let sum: i32 = frame.iter().map(|&s| s as i32).sum();
                            let _ = producer.push((sum / ch as i32) as i16);
                        }
                    }
                },
                |err| log::error!("cpal input stream error: {err}"),
                None,
            )
            .map_err(|e| {
                log::error!("build_input_stream: build failed: {e}");
                format!("Failed to build input stream: {e}")
            })?;

        stream
            .play()
            .map_err(|e| {
                log::error!("build_input_stream: play failed: {e}");
                format!("Failed to start input stream: {e}")
            })?;
        log::info!("build_input_stream: stream playing");
        Ok(stream)
    })
}

/// Build a cpal output stream that pops stereo PCM from an rtrb ring buffer.
/// The ring buffer contains interleaved stereo (L, R) i16 samples from the mixer.
/// Negotiates the device's native channel count and maps accordingly.
pub fn build_output_stream(
    device_id: Option<&str>,
    mut consumer: Consumer<i16>,
) -> Result<cpal::Stream, String> {
    log::info!("build_output_stream: device_id={device_id:?}");
    with_output_device(device_id, |device| {
        let (config, native_ch) = negotiate_output_config(&device)?;
        log::info!(
            "build_output_stream: negotiated ch={} rate={} (ring buffer is stereo)",
            config.channels, config.sample_rate
        );

        let stream = device
            .build_output_stream(
                &config,
                move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                    let ch = native_ch as usize;
                    if ch == 2 {
                        // Stereo pass-through from ring buffer
                        for sample in data.iter_mut() {
                            *sample = consumer.pop().unwrap_or(0);
                        }
                    } else if ch == 1 {
                        // Downmix stereo to mono
                        for sample in data.iter_mut() {
                            let l = consumer.pop().unwrap_or(0) as i32;
                            let r = consumer.pop().unwrap_or(0) as i32;
                            *sample = ((l + r) / 2) as i16;
                        }
                    } else {
                        // Multi-channel: put L/R in first two, silence the rest
                        for frame in data.chunks_mut(ch) {
                            let l = consumer.pop().unwrap_or(0);
                            let r = consumer.pop().unwrap_or(0);
                            frame[0] = l;
                            if frame.len() > 1 { frame[1] = r; }
                            for s in frame.iter_mut().skip(2) { *s = 0; }
                        }
                    }
                },
                |err| log::error!("cpal output stream error: {err}"),
                None,
            )
            .map_err(|e| {
                log::error!("build_output_stream: build failed: {e}");
                format!("Failed to build output stream: {e}")
            })?;

        stream
            .play()
            .map_err(|e| {
                log::error!("build_output_stream: play failed: {e}");
                format!("Failed to start output stream: {e}")
            })?;
        log::info!("build_output_stream: stream playing");
        Ok(stream)
    })
}

// ===========================================================================
// Mic level test (cross-platform)
// ===========================================================================

/// State for a running mic level test.
/// Holds both cpal streams (input + loopback output) and a stop flag.
pub struct MicTest {
    _input_stream: cpal::Stream,
    _output_stream: cpal::Stream,
    running: Arc<AtomicBool>,
}

impl MicTest {
    /// Start capturing from the selected mic and playing back through the selected speaker.
    /// Also emits `voice:mic-level` events with RMS level data.
    pub fn start(
        mic_device_id: Option<&str>,
        speaker_device_id: Option<&str>,
        app: tauri::AppHandle,
    ) -> Result<Self, String> {
        log::info!("MicTest::start: mic={mic_device_id:?}, speaker={speaker_device_id:?}");
        let running = Arc::new(AtomicBool::new(true));
        let running_input = running.clone();

        // Ring buffer for loopback: mic input → speaker output (mono, 48kHz)
        // 48000 samples = 1 second buffer
        let (mut loopback_prod, mut loopback_cons) = rtrb::RingBuffer::new(48000);

        let app_cb = app.clone();

        // Track samples to compute RMS over ~50ms chunks (2400 samples at 48kHz)
        let mut accum: f64 = 0.0;
        let mut count: u32 = 0;
        const CHUNK: u32 = 2400;

        // Input stream: capture mic → ring buffer + level meter
        let input_stream = with_input_device(mic_device_id, |device| {
            let (config, native_ch) = negotiate_input_config(&device)?;
            log::info!(
                "MicTest: building input stream (negotiated ch={} rate={})",
                config.channels, config.sample_rate
            );

            let stream = device
                .build_input_stream(
                    &config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        if !running_input.load(Ordering::Relaxed) {
                            return;
                        }
                        let ch = native_ch as usize;
                        // Process frames, downmixing to mono if needed
                        let frames = if ch <= 1 { data.len() } else { data.len() / ch };
                        for i in 0..frames {
                            let sample = if ch <= 1 {
                                data[i]
                            } else {
                                let offset = i * ch;
                                let sum: i32 = data[offset..offset + ch]
                                    .iter().map(|&s| s as i32).sum();
                                (sum / ch as i32) as i16
                            };

                            // Feed loopback (non-blocking, drops if full)
                            let _ = loopback_prod.push(sample);

                            // RMS level computation
                            let s = sample as f64 / i16::MAX as f64;
                            accum += s * s;
                            count += 1;
                            if count >= CHUNK {
                                let rms = (accum / count as f64).sqrt();
                                let level = (rms * 600.0).min(100.0);
                                let _ = app_cb.emit("voice:mic-level", level);
                                accum = 0.0;
                                count = 0;
                            }
                        }
                    },
                    |err| log::error!("mic test input stream error: {err}"),
                    None,
                )
                .map_err(|e| {
                    log::error!("MicTest: build input stream failed: {e}");
                    format!("Failed to build mic test input stream: {e}")
                })?;

            stream
                .play()
                .map_err(|e| {
                    log::error!("MicTest: play input stream failed: {e}");
                    format!("Failed to start mic test input stream: {e}")
                })?;
            log::info!("MicTest: input stream playing");
            Ok(stream)
        })?;

        // Output stream: ring buffer → speaker (mono loopback to all device channels)
        let output_stream = with_output_device(speaker_device_id, |device| {
            let (config, native_ch) = negotiate_output_config(&device)?;
            log::info!(
                "MicTest: building output stream (negotiated ch={} rate={})",
                config.channels, config.sample_rate
            );

            let stream = device
                .build_output_stream(
                    &config,
                    move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                        let ch = native_ch as usize;
                        // Duplicate mono loopback sample to all output channels
                        for frame in data.chunks_exact_mut(ch) {
                            let sample = loopback_cons.pop().unwrap_or(0);
                            for s in frame.iter_mut() {
                                *s = sample;
                            }
                        }
                    },
                    |err| log::error!("mic test output stream error: {err}"),
                    None,
                )
                .map_err(|e| {
                    log::error!("MicTest: build output stream failed: {e}");
                    format!("Failed to build mic test output stream: {e}")
                })?;

            stream
                .play()
                .map_err(|e| {
                    log::error!("MicTest: play output stream failed: {e}");
                    format!("Failed to start mic test output stream: {e}")
                })?;
            log::info!("MicTest: output stream playing");
            Ok(stream)
        })?;

        log::info!("MicTest::start: both streams running");
        Ok(Self {
            _input_stream: input_stream,
            _output_stream: output_stream,
            running,
        })
    }

    pub fn stop(&self) {
        log::info!("MicTest::stop");
        self.running.store(false, Ordering::Relaxed);
    }
}
