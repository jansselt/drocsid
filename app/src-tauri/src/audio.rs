use serde::Serialize;
use std::process::Command;
use std::sync::Mutex;

/// Handle for the virtual null-sink, stored for cleanup on disconnect / app exit.
/// PwNode = PipeWire node ID (from pw-cli), PaModule = PulseAudio module ID (from pactl).
enum VoiceSinkHandle {
    PwNode(u32),
    PaModule(u32),
}

static VOICE_INPUT_HANDLE: Mutex<Option<VoiceSinkHandle>> = Mutex::new(None);

#[derive(Serialize, Clone, Debug)]
pub struct AudioSink {
    pub name: String,
    pub description: String,
    pub index: u32,
}

#[tauri::command]
pub async fn list_audio_sinks() -> Result<Vec<AudioSink>, String> {
    let output = Command::new("pactl")
        .args(["-f", "json", "list", "sinks"])
        .output()
        .map_err(|e| format!("Failed to run pactl: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "pactl failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let raw: Vec<serde_json::Value> =
        serde_json::from_str(&json_str).map_err(|e| format!("Parse error: {e}"))?;

    let sinks = raw
        .iter()
        .filter_map(|s| {
            Some(AudioSink {
                name: s.get("name")?.as_str()?.to_string(),
                description: s
                    .get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or("Unknown")
                    .to_string(),
                index: s.get("index")?.as_u64()? as u32,
            })
        })
        .collect();

    Ok(sinks)
}

#[tauri::command]
pub async fn get_default_audio_sink() -> Result<String, String> {
    let output = Command::new("pactl")
        .args(["get-default-sink"])
        .output()
        .map_err(|e| format!("Failed to run pactl: {e}"))?;

    if !output.status.success() {
        return Err("pactl get-default-sink failed".into());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
pub async fn set_audio_sink(sink_name: String) -> Result<u32, String> {
    let our_pid = std::process::id();
    let child_pids = get_descendant_pids(our_pid);

    let output = Command::new("pactl")
        .args(["-f", "json", "list", "sink-inputs"])
        .output()
        .map_err(|e| format!("Failed to run pactl: {e}"))?;

    if !output.status.success() {
        return Err("pactl list sink-inputs failed".into());
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let inputs: Vec<serde_json::Value> =
        serde_json::from_str(&json_str).map_err(|e| format!("Parse error: {e}"))?;

    let mut moved = 0u32;

    for input in &inputs {
        let props = input.get("properties").unwrap_or(input);
        let pid_str = props
            .get("application.process.id")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if let Ok(pid) = pid_str.parse::<u32>() {
            if pid == our_pid || child_pids.contains(&pid) {
                let input_index = input
                    .get("index")
                    .and_then(|v| v.as_u64())
                    .ok_or("Missing sink-input index")?;

                let status = Command::new("pactl")
                    .args([
                        "move-sink-input",
                        &input_index.to_string(),
                        &sink_name,
                    ])
                    .status()
                    .map_err(|e| format!("pactl move-sink-input failed: {e}"))?;

                if !status.success() {
                    return Err(format!(
                        "Failed to move sink-input {input_index} to {sink_name}"
                    ));
                }
                moved += 1;
            }
        }
    }

    Ok(moved)
}

// ---------------------------------------------------------------------------
// Audio sources (microphone / input devices)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
pub struct AudioSource {
    pub name: String,
    pub description: String,
    pub index: u32,
}

#[tauri::command]
pub async fn list_audio_sources() -> Result<Vec<AudioSource>, String> {
    let output = Command::new("pactl")
        .args(["-f", "json", "list", "sources"])
        .output()
        .map_err(|e| format!("Failed to run pactl: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "pactl failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let raw: Vec<serde_json::Value> =
        serde_json::from_str(&json_str).map_err(|e| format!("Parse error: {e}"))?;

    let sources = raw
        .iter()
        .filter_map(|s| {
            let name = s.get("name")?.as_str()?.to_string();
            // Filter out monitor sources of hardware output sinks (e.g. alsa_output.*.monitor,
            // bluez_output.*.monitor) but keep monitors of virtual/null sinks (e.g. mic.monitor,
            // drocsid_voice_in.monitor) which are used for mic routing.
            if name.ends_with(".monitor") {
                let base = &name[..name.len() - ".monitor".len()];
                if base.starts_with("alsa_") || base.starts_with("bluez_") {
                    return None;
                }
            }
            Some(AudioSource {
                name,
                description: s
                    .get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or("Unknown")
                    .to_string(),
                index: s.get("index")?.as_u64()? as u32,
            })
        })
        .collect();

    Ok(sources)
}

#[tauri::command]
pub async fn get_default_audio_source() -> Result<String, String> {
    let output = Command::new("pactl")
        .args(["get-default-source"])
        .output()
        .map_err(|e| format!("Failed to run pactl: {e}"))?;

    if !output.status.success() {
        return Err("pactl get-default-source failed".into());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
pub async fn set_audio_source(source_name: String) -> Result<u32, String> {
    let our_pid = std::process::id();
    let child_pids = get_descendant_pids(our_pid);

    let output = Command::new("pactl")
        .args(["-f", "json", "list", "source-outputs"])
        .output()
        .map_err(|e| format!("Failed to run pactl: {e}"))?;

    if !output.status.success() {
        return Err("pactl list source-outputs failed".into());
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let outputs: Vec<serde_json::Value> =
        serde_json::from_str(&json_str).map_err(|e| format!("Parse error: {e}"))?;

    let mut moved = 0u32;

    for entry in &outputs {
        let props = entry.get("properties").unwrap_or(entry);
        let pid_str = props
            .get("application.process.id")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if let Ok(pid) = pid_str.parse::<u32>() {
            if pid == our_pid || child_pids.contains(&pid) {
                let output_index = entry
                    .get("index")
                    .and_then(|v| v.as_u64())
                    .ok_or("Missing source-output index")?;

                let status = Command::new("pactl")
                    .args([
                        "move-source-output",
                        &output_index.to_string(),
                        &source_name,
                    ])
                    .status()
                    .map_err(|e| format!("pactl move-source-output failed: {e}"))?;

                if !status.success() {
                    return Err(format!(
                        "Failed to move source-output {output_index} to {source_name}"
                    ));
                }
                moved += 1;
            }
        }
    }

    Ok(moved)
}

// ---------------------------------------------------------------------------
// Virtual PipeWire sink for mic input routing
// ---------------------------------------------------------------------------
// Creates a null-sink that appears as a node in qpwgraph / Helvum / pavucontrol.
// The user can route any physical mic to it. The app reads from the sink's
// monitor source. Cleaned up on voice disconnect or app exit.

const VOICE_INPUT_SINK: &str = "drocsid_voice_in";

#[tauri::command]
pub async fn create_voice_input_sink() -> Result<(), String> {
    // Clean up any stale sink from a previous crash
    destroy_voice_input_sink_inner();

    // Try PipeWire-native creation first (proper naming in qpwgraph)
    if let Ok(()) = create_sink_pw_cli() {
        return Ok(());
    }

    // Fallback to PulseAudio module
    create_sink_pactl()
}

/// Create virtual sink via pw-cli for proper PipeWire node naming.
fn create_sink_pw_cli() -> Result<(), String> {
    let props = format!(
        "{{ factory.name = support.null-audio-sink \
           node.name = {VOICE_INPUT_SINK} \
           node.description = \"Drocsid Voice Sound In\" \
           media.class = Audio/Sink \
           audio.channels = 2 \
           audio.position = [ FL FR ] \
           object.linger = true }}"
    );

    let output = Command::new("pw-cli")
        .args(["create-node", "adapter", &props])
        .output()
        .map_err(|e| format!("pw-cli: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "pw-cli create-node failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // Parse node ID from output like "id: 42, type: PipeWire:Interface:Node/4"
    let stdout = String::from_utf8_lossy(&output.stdout);
    let node_id = stdout
        .split("id:")
        .nth(1)
        .and_then(|s| s.split(',').next())
        .and_then(|s| s.trim().parse::<u32>().ok())
        .ok_or("Failed to parse node ID from pw-cli output")?;

    *VOICE_INPUT_HANDLE.lock().unwrap() = Some(VoiceSinkHandle::PwNode(node_id));
    Ok(())
}

/// Fallback: create virtual sink via pactl module-null-sink.
fn create_sink_pactl() -> Result<(), String> {
    // Use sh -c to handle property string quoting correctly
    let cmd = format!(
        "pactl load-module module-null-sink \
         sink_name={VOICE_INPUT_SINK} \
         rate=48000 channels=2 \
         channel_map=front-left,front-right \
         'sink_properties=device.description=\"Drocsid Voice Sound In\"'"
    );

    let output = Command::new("sh")
        .args(["-c", &cmd])
        .output()
        .map_err(|e| format!("pactl: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "pactl load-module failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let module_id: u32 = String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse()
        .map_err(|e| format!("Invalid module ID: {e}"))?;

    *VOICE_INPUT_HANDLE.lock().unwrap() = Some(VoiceSinkHandle::PaModule(module_id));
    Ok(())
}

/// Set the PulseAudio/PipeWire default audio source.
/// Used to route the virtual sink's monitor as the default input before
/// getUserMedia is called, so WebKit2GTK picks it up automatically.
#[tauri::command]
pub async fn set_default_audio_source(source_name: String) -> Result<(), String> {
    let status = Command::new("pactl")
        .args(["set-default-source", &source_name])
        .status()
        .map_err(|e| format!("pactl set-default-source failed: {e}"))?;

    if !status.success() {
        return Err(format!(
            "Failed to set default source to {source_name}"
        ));
    }

    Ok(())
}

#[tauri::command]
pub async fn destroy_voice_input_sink() -> Result<(), String> {
    destroy_voice_input_sink_inner();
    Ok(())
}

fn destroy_voice_input_sink_inner() {
    if let Some(handle) = VOICE_INPUT_HANDLE.lock().unwrap().take() {
        match handle {
            VoiceSinkHandle::PwNode(id) => {
                let _ = Command::new("pw-cli")
                    .args(["destroy", &id.to_string()])
                    .status();
            }
            VoiceSinkHandle::PaModule(id) => {
                let _ = Command::new("pactl")
                    .args(["unload-module", &id.to_string()])
                    .status();
            }
        }
    }
}

// ---------------------------------------------------------------------------
// PipeWire per-stream naming via pw-cli / pw-dump
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn label_audio_streams() -> Result<u32, String> {
    // Check if pw-cli is available
    if Command::new("pw-cli").arg("--version").output().is_err() {
        return Ok(0);
    }

    let output = Command::new("pw-dump")
        .output()
        .map_err(|e| format!("Failed to run pw-dump: {e}"))?;

    if !output.status.success() {
        return Ok(0); // graceful fallback
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let objects: Vec<serde_json::Value> =
        serde_json::from_str(&json_str).map_err(|e| format!("pw-dump parse error: {e}"))?;

    let our_pid = std::process::id();
    let child_pids = get_descendant_pids(our_pid);

    let mut labeled = 0u32;

    for obj in &objects {
        let obj_type = obj
            .get("type")
            .and_then(|t| t.as_str())
            .unwrap_or("");
        if obj_type != "PipeWire:Interface:Node" {
            continue;
        }

        let props = match obj.pointer("/info/props") {
            Some(p) => p,
            None => continue,
        };

        // Check if this node belongs to our process tree
        let pid_str = props
            .get("application.process.id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let pid = match pid_str.parse::<u32>() {
            Ok(p) => p,
            Err(_) => continue,
        };
        if pid != our_pid && !child_pids.contains(&pid) {
            continue;
        }

        let node_id = match obj.get("id").and_then(|v| v.as_u64()) {
            Some(id) => id,
            None => continue,
        };

        let media_class = props
            .get("media.class")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let label = match media_class {
            "Stream/Input/Audio" => "Drocsid Voice Sound In",
            "Stream/Output/Audio" => "Drocsid Voice Sound Out",
            _ => continue,
        };

        let param = format!(r#"{{ "media.name": "{label}" }}"#);
        let _ = Command::new("pw-cli")
            .args(["set-param", &node_id.to_string(), "Props", &param])
            .status();

        labeled += 1;
    }

    Ok(labeled)
}

/// Walk /proc to find all descendant PIDs of `parent`.
fn get_descendant_pids(parent: u32) -> Vec<u32> {
    let mut result = Vec::new();
    let mut queue = vec![parent];

    while let Some(pid) = queue.pop() {
        let entries = match std::fs::read_dir("/proc") {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if let Ok(child_pid) = name_str.parse::<u32>() {
                if let Ok(stat) = std::fs::read_to_string(format!("/proc/{child_pid}/stat")) {
                    // Format: pid (comm) state ppid ...
                    if let Some(after_comm) = stat.rfind(')') {
                        let fields: Vec<&str> =
                            stat[after_comm + 2..].split_whitespace().collect();
                        if let Some(ppid_str) = fields.get(1) {
                            if let Ok(ppid) = ppid_str.parse::<u32>() {
                                if ppid == pid {
                                    result.push(child_pid);
                                    queue.push(child_pid);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    result
}
