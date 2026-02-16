use serde::Serialize;
use std::process::Command;

/// PipeWire node ID of the virtual null-sink, stored for cleanup on disconnect / app exit.

// ---------------------------------------------------------------------------
// PipeWire helpers (pw-dump / pw-link)
// ---------------------------------------------------------------------------

/// Run pw-dump and return the full list of PipeWire objects.
fn pw_dump_all() -> Result<Vec<serde_json::Value>, String> {
    let output = Command::new("pw-dump")
        .output()
        .map_err(|e| format!("Failed to run pw-dump: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "pw-dump failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(&json_str).map_err(|e| format!("pw-dump parse error: {e}"))
}

/// Extract application.process.id from pw-dump props, handling both integer and string types.
fn get_pid_from_props(props: &serde_json::Value) -> Option<u32> {
    let v = props.get("application.process.id")?;
    if let Some(n) = v.as_u64() {
        return Some(n as u32);
    }
    v.as_str()?.parse::<u32>().ok()
}

struct PwPort {
    id: u64,
    channel: String,
}

/// Find PipeWire node IDs belonging to our process tree with the given media.class.
fn find_our_stream_nodes(
    objects: &[serde_json::Value],
    our_pid: u32,
    child_pids: &[u32],
    media_class: &str,
) -> Vec<u64> {
    objects
        .iter()
        .filter_map(|obj| {
            if obj.get("type")?.as_str()? != "PipeWire:Interface:Node" {
                return None;
            }
            let props = obj.pointer("/info/props")?;
            let pid = get_pid_from_props(props)?;
            if pid != our_pid && !child_pids.contains(&pid) {
                return None;
            }
            if props.get("media.class")?.as_str()? != media_class {
                return None;
            }
            obj.get("id")?.as_u64()
        })
        .collect()
}

/// Find a PipeWire node ID by its node.name property.
fn find_node_by_name(objects: &[serde_json::Value], name: &str) -> Option<u64> {
    objects.iter().find_map(|obj| {
        if obj.get("type")?.as_str()? != "PipeWire:Interface:Node" {
            return None;
        }
        let props = obj.pointer("/info/props")?;
        if props.get("node.name")?.as_str()? != name {
            return None;
        }
        obj.get("id")?.as_u64()
    })
}

/// Find ports belonging to a given node, filtered by direction ("input" or "output").
fn find_node_ports(
    objects: &[serde_json::Value],
    node_id: u64,
    direction: &str,
) -> Vec<PwPort> {
    objects
        .iter()
        .filter_map(|obj| {
            if obj.get("type")?.as_str()? != "PipeWire:Interface:Port" {
                return None;
            }
            let info = obj.get("info")?;
            if info.get("direction")?.as_str()? != direction {
                return None;
            }
            let props = info.get("props")?;
            if props.get("node.id")?.as_u64()? != node_id {
                return None;
            }
            let port_id = obj.get("id")?.as_u64()?;
            let channel = props
                .get("audio.channel")
                .and_then(|v| v.as_str())
                .unwrap_or("MONO")
                .to_string();
            Some(PwPort {
                id: port_id,
                channel,
            })
        })
        .collect()
}

/// Find all link object IDs where the given port is the input (destination).
fn find_links_to_input_port(objects: &[serde_json::Value], input_port_id: u64) -> Vec<u64> {
    objects
        .iter()
        .filter_map(|obj| {
            if obj.get("type")?.as_str()? != "PipeWire:Interface:Link" {
                return None;
            }
            let info = obj.get("info")?;
            if info.get("input-port-id")?.as_u64()? != input_port_id {
                return None;
            }
            obj.get("id")?.as_u64()
        })
        .collect()
}

/// Find all link object IDs where the given port is the output (source).
fn find_links_from_output_port(objects: &[serde_json::Value], output_port_id: u64) -> Vec<u64> {
    objects
        .iter()
        .filter_map(|obj| {
            if obj.get("type")?.as_str()? != "PipeWire:Interface:Link" {
                return None;
            }
            let info = obj.get("info")?;
            if info.get("output-port-id")?.as_u64()? != output_port_id {
                return None;
            }
            obj.get("id")?.as_u64()
        })
        .collect()
}

/// Destroy a PipeWire link by its object ID.
fn pw_destroy_link(link_id: u64) {
    let _ = Command::new("pw-link")
        .args(["-d", &link_id.to_string()])
        .status();
}

/// Create a PipeWire link from output_port_id to input_port_id using numeric IDs.
fn pw_create_link(output_port_id: u64, input_port_id: u64) -> Result<(), String> {
    let status = Command::new("pw-link")
        .args([&output_port_id.to_string(), &input_port_id.to_string()])
        .status()
        .map_err(|e| format!("pw-link failed: {e}"))?;

    if !status.success() {
        return Err(format!(
            "Failed to link port {} -> {}",
            output_port_id, input_port_id
        ));
    }
    Ok(())
}

/// Match source output ports to stream input ports by audio channel.
/// Mono source → connect to all stream ports. Multi-channel → match by channel name.
fn match_ports(source_ports: &[PwPort], stream_ports: &[PwPort]) -> Vec<(u64, u64)> {
    if source_ports.len() == 1 {
        // Mono source: connect to all stream ports
        return stream_ports
            .iter()
            .map(|dst| (source_ports[0].id, dst.id))
            .collect();
    }

    // Try matching by channel name (FL→FL, FR→FR)
    let mut pairs: Vec<(u64, u64)> = source_ports
        .iter()
        .filter_map(|src| {
            stream_ports
                .iter()
                .find(|dst| dst.channel == src.channel)
                .map(|dst| (src.id, dst.id))
        })
        .collect();

    // If no channel matches (e.g. AUX0/AUX1 vs FL/FR), fall back to positional
    if pairs.is_empty() {
        pairs = source_ports
            .iter()
            .zip(stream_ports.iter())
            .map(|(src, dst)| (src.id, dst.id))
            .collect();
    }

    pairs
}

// ---------------------------------------------------------------------------
// Audio sinks (speakers / output devices)
// ---------------------------------------------------------------------------

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

/// Route the app's playback streams to the given sink via pw-dump + pw-link.
#[tauri::command]
pub async fn set_audio_sink(sink_name: String) -> Result<u32, String> {
    let objects = pw_dump_all()?;
    let our_pid = std::process::id();
    let child_pids = get_descendant_pids(our_pid);

    let playback_nodes =
        find_our_stream_nodes(&objects, our_pid, &child_pids, "Stream/Output/Audio");
    if playback_nodes.is_empty() {
        return Ok(0);
    }

    let target_node_id = find_node_by_name(&objects, &sink_name)
        .ok_or_else(|| format!("PipeWire sink node not found: {sink_name}"))?;
    let sink_input_ports = find_node_ports(&objects, target_node_id, "input");
    if sink_input_ports.is_empty() {
        return Err(format!("No input ports on sink {sink_name}"));
    }

    let mut moved = 0u32;
    for &stream_node_id in &playback_nodes {
        let stream_output_ports = find_node_ports(&objects, stream_node_id, "output");
        if stream_output_ports.is_empty() {
            continue;
        }

        // Disconnect existing links from our output ports
        for port in &stream_output_ports {
            for link_id in find_links_from_output_port(&objects, port.id) {
                pw_destroy_link(link_id);
            }
        }

        // Create new links: stream output → sink input
        let pairs = match_ports(&stream_output_ports, &sink_input_ports);
        for (out_port, in_port) in pairs {
            pw_create_link(out_port, in_port)?;
        }
        moved += 1;
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

/// Route the app's capture streams to the given source via pw-dump + pw-link.
#[tauri::command]
pub async fn set_audio_source(source_name: String) -> Result<u32, String> {
    let objects = pw_dump_all()?;
    let our_pid = std::process::id();
    let child_pids = get_descendant_pids(our_pid);

    let capture_nodes =
        find_our_stream_nodes(&objects, our_pid, &child_pids, "Stream/Input/Audio");
    if capture_nodes.is_empty() {
        return Ok(0);
    }

    // Resolve the target source:
    //   "foo.monitor" → find Audio/Sink node "foo", use its output (monitor) ports
    //   "foo"         → find Audio/Source node "foo", use its output (capture) ports
    let target_name = if source_name.ends_with(".monitor") {
        &source_name[..source_name.len() - ".monitor".len()]
    } else {
        &source_name
    };

    let target_node_id = find_node_by_name(&objects, target_name)
        .ok_or_else(|| format!("PipeWire node not found: {target_name}"))?;

    // For both cases, we want the "output" direction ports:
    //   - Audio/Source output ports = capture ports (audio flows out)
    //   - Audio/Sink output ports   = monitor ports (audio flows out)
    let source_ports = find_node_ports(&objects, target_node_id, "output");
    if source_ports.is_empty() {
        return Err(format!("No output ports on node {target_name}"));
    }

    let mut moved = 0u32;
    for &stream_node_id in &capture_nodes {
        let stream_input_ports = find_node_ports(&objects, stream_node_id, "input");
        if stream_input_ports.is_empty() {
            continue;
        }

        // Disconnect existing links to our input ports
        for port in &stream_input_ports {
            for link_id in find_links_to_input_port(&objects, port.id) {
                pw_destroy_link(link_id);
            }
        }

        // Create new links: source output → stream input
        let pairs = match_ports(&source_ports, &stream_input_ports);
        for (out_port, in_port) in pairs {
            pw_create_link(out_port, in_port)?;
        }
        moved += 1;
    }

    Ok(moved)
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

    let objects = pw_dump_all().unwrap_or_default();
    if objects.is_empty() {
        return Ok(0);
    }

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
        let pid = match get_pid_from_props(props) {
            Some(p) => p,
            None => continue,
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
