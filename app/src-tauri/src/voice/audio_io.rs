use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rtrb::{Consumer, Producer};
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

pub fn list_input_devices() -> Result<Vec<AudioDevice>, String> {
    let host = cpal::default_host();
    let default_id = host
        .default_input_device()
        .and_then(|d| d.id().ok());

    let mut raw = Vec::new();
    for device in host.input_devices().map_err(|e| e.to_string())? {
        let id = match device.id() {
            Ok(id) => id,
            Err(_) => continue,
        };
        let name = device
            .description()
            .map(|d| d.name().to_string())
            .unwrap_or_else(|_| id.1.clone());
        let is_default = Some(&id) == default_id.as_ref();
        raw.push(AudioDevice {
            id: id.1,
            name,
            is_default,
        });
    }
    Ok(dedup_alsa_devices(raw))
}

pub fn list_output_devices() -> Result<Vec<AudioDevice>, String> {
    let host = cpal::default_host();
    let default_id = host
        .default_output_device()
        .and_then(|d| d.id().ok());

    let mut raw = Vec::new();
    for device in host.output_devices().map_err(|e| e.to_string())? {
        let id = match device.id() {
            Ok(id) => id,
            Err(_) => continue,
        };
        let name = device
            .description()
            .map(|d| d.name().to_string())
            .unwrap_or_else(|_| id.1.clone());
        let is_default = Some(&id) == default_id.as_ref();
        raw.push(AudioDevice {
            id: id.1,
            name,
            is_default,
        });
    }
    Ok(dedup_alsa_devices(raw))
}

/// ALSA exposes many aliases for the same physical device (hw:, plughw:, default:,
/// sysdefault:, front:, surround*:, etc.). Deduplicate by description, keeping
/// the best ALSA ID for each unique device name. Prefers `plughw:` (handles
/// sample format conversion automatically), then `default:`, then any other.
fn dedup_alsa_devices(devices: Vec<AudioDevice>) -> Vec<AudioDevice> {
    use std::collections::HashMap;

    // Group by name, tracking best device per name
    let mut seen: HashMap<String, AudioDevice> = HashMap::new();
    for dev in devices {
        match seen.get(&dev.name) {
            None => {
                seen.insert(dev.name.clone(), dev);
            }
            Some(existing) => {
                // Pick the better ALSA ID, and merge the is_default flag
                let merged_default = existing.is_default || dev.is_default;
                let prefer_new = alsa_id_priority(&dev.id) > alsa_id_priority(&existing.id);
                if prefer_new {
                    let mut best = dev;
                    best.is_default = merged_default;
                    seen.insert(best.name.clone(), best);
                } else {
                    seen.get_mut(&existing.name.clone()).unwrap().is_default = merged_default;
                }
            }
        }
    }

    let mut result: Vec<AudioDevice> = seen.into_values().collect();
    // Put default device first, then sort by name
    result.sort_by(|a, b| b.is_default.cmp(&a.is_default).then_with(|| a.name.cmp(&b.name)));
    result
}

/// Priority for ALSA device ID prefixes. Higher = preferred.
/// `plughw:` does automatic format/rate conversion so it's safest.
fn alsa_id_priority(id: &str) -> u8 {
    if id.starts_with("plughw:") {
        3
    } else if id.starts_with("default:") {
        2
    } else if id.starts_with("sysdefault:") {
        1
    } else {
        0
    }
}

fn find_input_device(device_id: Option<&str>) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    match device_id {
        Some(id) if id != "default" => host
            .input_devices()
            .map_err(|e| e.to_string())?
            .find(|d| d.id().ok().map(|did| did.1.as_str() == id).unwrap_or(false))
            .ok_or_else(|| format!("Input device not found: {id}")),
        _ => host
            .default_input_device()
            .ok_or_else(|| "No default input device".into()),
    }
}

fn find_output_device(device_id: Option<&str>) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    match device_id {
        Some(id) if id != "default" => host
            .output_devices()
            .map_err(|e| e.to_string())?
            .find(|d| d.id().ok().map(|did| did.1.as_str() == id).unwrap_or(false))
            .ok_or_else(|| format!("Output device not found: {id}")),
        _ => host
            .default_output_device()
            .ok_or_else(|| "No default output device".into()),
    }
}

/// Build a cpal input stream (mono, 48 kHz) that pushes PCM samples into an rtrb ring buffer.
/// The cpal callback runs on a real-time OS thread — only non-blocking ring buffer writes.
pub fn build_input_stream(
    device_id: Option<&str>,
    mut producer: Producer<i16>,
) -> Result<cpal::Stream, String> {
    let device = find_input_device(device_id)?;
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
}

/// Build a cpal output stream (stereo, 48 kHz) that pops mixed PCM from an rtrb ring buffer.
/// Fills zeros on underrun (silence).
pub fn build_output_stream(
    device_id: Option<&str>,
    mut consumer: Consumer<i16>,
) -> Result<cpal::Stream, String> {
    let device = find_output_device(device_id)?;
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
}
