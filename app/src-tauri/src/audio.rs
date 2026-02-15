use serde::Serialize;
use std::process::Command;

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
