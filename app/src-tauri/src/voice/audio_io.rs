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
            std::env::set_var("PIPEWIRE_NODE", name);
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
            std::env::set_var("PIPEWIRE_NODE", name);
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

    pub fn list_input_devices() -> Result<Vec<AudioDevice>, String> {
        let host = cpal::default_host();
        let default_name = host
            .default_input_device()
            .and_then(|d| d.name().ok());

        let devices: Vec<AudioDevice> = host
            .input_devices()
            .map_err(|e| format!("Failed to enumerate input devices: {e}"))?
            .filter_map(|device| {
                let name = device.name().ok()?;
                let is_default = default_name.as_deref() == Some(&name);
                Some(AudioDevice {
                    id: name.clone(),
                    name,
                    is_default,
                })
            })
            .collect();

        Ok(devices)
    }

    pub fn list_output_devices() -> Result<Vec<AudioDevice>, String> {
        let host = cpal::default_host();
        let default_name = host
            .default_output_device()
            .and_then(|d| d.name().ok());

        let devices: Vec<AudioDevice> = host
            .output_devices()
            .map_err(|e| format!("Failed to enumerate output devices: {e}"))?
            .filter_map(|device| {
                let name = device.name().ok()?;
                let is_default = default_name.as_deref() == Some(&name);
                Some(AudioDevice {
                    id: name.clone(),
                    name,
                    is_default,
                })
            })
            .collect();

        Ok(devices)
    }

    fn resolve_input_device(device_id: Option<&str>) -> Result<cpal::Device, String> {
        let host = cpal::default_host();
        if let Some(id) = device_id {
            for device in host.input_devices().map_err(|e| e.to_string())? {
                if let Ok(name) = device.name() {
                    if name == id {
                        return Ok(device);
                    }
                }
            }
            return Err(format!("Input device not found: {id}"));
        }
        host.default_input_device()
            .ok_or_else(|| "No default input device available".to_string())
    }

    fn resolve_output_device(device_id: Option<&str>) -> Result<cpal::Device, String> {
        let host = cpal::default_host();
        if let Some(id) = device_id {
            for device in host.output_devices().map_err(|e| e.to_string())? {
                if let Ok(name) = device.name() {
                    if name == id {
                        return Ok(device);
                    }
                }
            }
            return Err(format!("Output device not found: {id}"));
        }
        host.default_output_device()
            .ok_or_else(|| "No default output device available".to_string())
    }

    /// Resolve input device by name and execute closure.
    pub fn with_input_device<F, T>(device_id: Option<&str>, f: F) -> Result<T, String>
    where
        F: FnOnce(cpal::Device) -> Result<T, String>,
    {
        let device = resolve_input_device(device_id)?;
        f(device)
    }

    /// Resolve output device by name and execute closure.
    pub fn with_output_device<F, T>(device_id: Option<&str>, f: F) -> Result<T, String>
    where
        F: FnOnce(cpal::Device) -> Result<T, String>,
    {
        let device = resolve_output_device(device_id)?;
        f(device)
    }
}

// Re-export platform implementations
pub use platform::{list_input_devices, list_output_devices};
use platform::{with_input_device, with_output_device};

// ===========================================================================
// Audio stream builders (cross-platform)
// ===========================================================================

/// Build a cpal input stream (mono, 48 kHz) that pushes PCM samples into an rtrb ring buffer.
pub fn build_input_stream(
    device_id: Option<&str>,
    mut producer: Producer<i16>,
) -> Result<cpal::Stream, String> {
    with_input_device(device_id, |device| {
        let config = cpal::StreamConfig {
            channels: 1,
            sample_rate: 48000,
            buffer_size: cpal::BufferSize::Default,
        };

        let stream = device
            .build_input_stream(
                &config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    for &sample in data {
                        // Non-blocking push — drops samples if buffer is full
                        let _ = producer.push(sample);
                    }
                },
                |err| eprintln!("[voice] cpal input error: {err}"),
                None,
            )
            .map_err(|e| format!("Failed to build input stream: {e}"))?;

        stream
            .play()
            .map_err(|e| format!("Failed to start input stream: {e}"))?;
        Ok(stream)
    })
}

/// Build a cpal output stream (stereo, 48 kHz) that pops mixed PCM from an rtrb ring buffer.
pub fn build_output_stream(
    device_id: Option<&str>,
    mut consumer: Consumer<i16>,
) -> Result<cpal::Stream, String> {
    with_output_device(device_id, |device| {
        let config = cpal::StreamConfig {
            channels: 2,
            sample_rate: 48000,
            buffer_size: cpal::BufferSize::Default,
        };

        let stream = device
            .build_output_stream(
                &config,
                move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                    for sample in data.iter_mut() {
                        *sample = consumer.pop().unwrap_or(0);
                    }
                },
                |err| eprintln!("[voice] cpal output error: {err}"),
                None,
            )
            .map_err(|e| format!("Failed to build output stream: {e}"))?;

        stream
            .play()
            .map_err(|e| format!("Failed to start output stream: {e}"))?;
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
        mic_device_id: &str,
        speaker_device_id: &str,
        app: tauri::AppHandle,
    ) -> Result<Self, String> {
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
        let input_stream = with_input_device(Some(mic_device_id), |device| {
            let config = cpal::StreamConfig {
                channels: 1,
                sample_rate: 48000,
                buffer_size: cpal::BufferSize::Default,
            };

            let stream = device
                .build_input_stream(
                    &config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        if !running_input.load(Ordering::Relaxed) {
                            return;
                        }
                        for &sample in data {
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
                    |err| eprintln!("[voice] mic test input error: {err}"),
                    None,
                )
                .map_err(|e| format!("Failed to build mic test input stream: {e}"))?;

            stream
                .play()
                .map_err(|e| format!("Failed to start mic test input stream: {e}"))?;
            Ok(stream)
        })?;

        // Output stream: ring buffer → speaker (mono loopback played as stereo)
        let output_stream = with_output_device(Some(speaker_device_id), |device| {
            let config = cpal::StreamConfig {
                channels: 2,
                sample_rate: 48000,
                buffer_size: cpal::BufferSize::Default,
            };

            let stream = device
                .build_output_stream(
                    &config,
                    move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                        // Stereo output: duplicate mono sample to both channels
                        for chunk in data.chunks_exact_mut(2) {
                            let sample = loopback_cons.pop().unwrap_or(0);
                            chunk[0] = sample;
                            chunk[1] = sample;
                        }
                    },
                    |err| eprintln!("[voice] mic test output error: {err}"),
                    None,
                )
                .map_err(|e| format!("Failed to build mic test output stream: {e}"))?;

            stream
                .play()
                .map_err(|e| format!("Failed to start mic test output stream: {e}"))?;
            Ok(stream)
        })?;

        Ok(Self {
            _input_stream: input_stream,
            _output_stream: output_stream,
            running,
        })
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::Relaxed);
    }
}
