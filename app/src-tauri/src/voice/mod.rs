mod audio_io;
mod manager;
pub(crate) mod suppressor;

use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use manager::VoiceManager;

pub use audio_io::AudioDevice;

/// Managed Tauri state holding the active voice session (if any).
pub struct VoiceState(pub Arc<Mutex<Option<VoiceManager>>>);

impl VoiceState {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(None)))
    }
}

/// Managed Tauri state for the mic test stream.
pub struct MicTestState(pub Arc<Mutex<Option<audio_io::MicTest>>>);

impl MicTestState {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(None)))
    }
}

#[tauri::command]
pub async fn voice_connect(
    app: tauri::AppHandle,
    state: State<'_, VoiceState>,
    url: String,
    token: String,
    mic_device_id: Option<String>,
    speaker_device_id: Option<String>,
) -> Result<(), String> {
    log::info!("voice_connect called: url={url}, mic={mic_device_id:?}, speaker={speaker_device_id:?}");

    let mut guard = state.0.lock().await;

    // Disconnect existing session if any
    if let Some(old) = guard.take() {
        log::info!("voice_connect: disconnecting previous session");
        old.disconnect().await;
    }

    let mgr = VoiceManager::connect(
        app,
        &url,
        &token,
        mic_device_id.as_deref(),
        speaker_device_id.as_deref(),
    )
    .await
    .map_err(|e| {
        log::error!("voice_connect FAILED: {e}");
        e
    })?;

    log::info!("voice_connect: success");
    *guard = Some(mgr);
    Ok(())
}

#[tauri::command]
pub async fn voice_disconnect(state: State<'_, VoiceState>) -> Result<(), String> {
    log::info!("voice_disconnect called");
    let mut guard = state.0.lock().await;
    if let Some(mgr) = guard.take() {
        mgr.disconnect().await;
        log::info!("voice_disconnect: done");
    } else {
        log::warn!("voice_disconnect: no active session");
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_set_mute(state: State<'_, VoiceState>, muted: bool) -> Result<(), String> {
    log::debug!("voice_set_mute: {muted}");
    let guard = state.0.lock().await;
    if let Some(mgr) = guard.as_ref() {
        mgr.set_mute(muted);
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_set_deaf(state: State<'_, VoiceState>, deaf: bool) -> Result<(), String> {
    log::debug!("voice_set_deaf: {deaf}");
    let guard = state.0.lock().await;
    if let Some(mgr) = guard.as_ref() {
        mgr.set_deaf(deaf);
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_set_noise_suppression(
    state: State<'_, VoiceState>,
    enabled: bool,
) -> Result<(), String> {
    log::debug!("voice_set_noise_suppression: {enabled}");
    let guard = state.0.lock().await;
    if let Some(mgr) = guard.as_ref() {
        mgr.set_noise_suppression(enabled);
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_set_user_volume(
    state: State<'_, VoiceState>,
    identity: String,
    volume_percent: u32,
) -> Result<(), String> {
    log::debug!("voice_set_user_volume: {identity} -> {volume_percent}%");
    let guard = state.0.lock().await;
    if let Some(mgr) = guard.as_ref() {
        mgr.set_user_volume(&identity, volume_percent).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_set_input_device(
    state: State<'_, VoiceState>,
    device_id: Option<String>,
) -> Result<(), String> {
    log::info!("voice_set_input_device: {device_id:?}");
    let mut guard = state.0.lock().await;
    if let Some(mgr) = guard.as_mut() {
        mgr.set_input_device(device_id.as_deref())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_set_output_device(
    state: State<'_, VoiceState>,
    device_id: Option<String>,
) -> Result<(), String> {
    log::info!("voice_set_output_device: {device_id:?}");
    let mut guard = state.0.lock().await;
    if let Some(mgr) = guard.as_mut() {
        mgr.set_output_device(device_id.as_deref())?;
    }
    Ok(())
}

#[tauri::command]
pub fn voice_list_input_devices() -> Result<Vec<AudioDevice>, String> {
    log::info!("voice_list_input_devices called");
    let devices = audio_io::list_input_devices().map_err(|e| {
        log::error!("voice_list_input_devices FAILED: {e}");
        e
    })?;
    log::info!("voice_list_input_devices: found {} devices", devices.len());
    for d in &devices {
        log::debug!("  input: id={} name={:?} default={}", d.id, d.name, d.is_default);
    }
    Ok(devices)
}

#[tauri::command]
pub fn voice_list_output_devices() -> Result<Vec<AudioDevice>, String> {
    log::info!("voice_list_output_devices called");
    let devices = audio_io::list_output_devices().map_err(|e| {
        log::error!("voice_list_output_devices FAILED: {e}");
        e
    })?;
    log::info!("voice_list_output_devices: found {} devices", devices.len());
    for d in &devices {
        log::debug!("  output: id={} name={:?} default={}", d.id, d.name, d.is_default);
    }
    Ok(devices)
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn voice_start_audio_share(
    app: tauri::AppHandle,
    state: State<'_, VoiceState>,
    target_node_ids: Vec<u64>,
    system_mode: Option<bool>,
) -> Result<(), String> {
    log::info!(
        "voice_start_audio_share: targets={target_node_ids:?}, system={}",
        system_mode.unwrap_or(false)
    );
    let mut guard = state.0.lock().await;
    if let Some(mgr) = guard.as_mut() {
        mgr.start_audio_share(app, target_node_ids, system_mode.unwrap_or(false))
            .await
    } else {
        Err("Not in a voice channel".into())
    }
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn voice_stop_audio_share(state: State<'_, VoiceState>) -> Result<(), String> {
    log::info!("voice_stop_audio_share called");
    let mut guard = state.0.lock().await;
    if let Some(mgr) = guard.as_mut() {
        mgr.stop_audio_share().await
    } else {
        Ok(())
    }
}

#[tauri::command]
pub async fn voice_start_camera(state: State<'_, VoiceState>) -> Result<(), String> {
    log::info!("voice_start_camera called");
    let mut guard = state.0.lock().await;
    if let Some(mgr) = guard.as_mut() {
        mgr.start_camera().await
    } else {
        Err("Not in a voice channel".into())
    }
}

#[tauri::command]
pub async fn voice_stop_camera(state: State<'_, VoiceState>) -> Result<(), String> {
    log::info!("voice_stop_camera called");
    let mut guard = state.0.lock().await;
    if let Some(mgr) = guard.as_mut() {
        mgr.stop_camera().await
    } else {
        Ok(())
    }
}

#[tauri::command]
pub async fn voice_start_screenshare(state: State<'_, VoiceState>) -> Result<(), String> {
    log::info!("voice_start_screenshare called");
    let mut guard = state.0.lock().await;
    if let Some(mgr) = guard.as_mut() {
        mgr.start_screenshare().await
    } else {
        Err("Not in a voice channel".into())
    }
}

#[tauri::command]
pub async fn voice_stop_screenshare(state: State<'_, VoiceState>) -> Result<(), String> {
    log::info!("voice_stop_screenshare called");
    let mut guard = state.0.lock().await;
    if let Some(mgr) = guard.as_mut() {
        mgr.stop_screenshare().await
    } else {
        Ok(())
    }
}

#[tauri::command]
pub async fn voice_push_video_frame(
    state: State<'_, VoiceState>,
    data: String,
    source: String,
) -> Result<(), String> {
    let guard = state.0.lock().await;
    if let Some(mgr) = guard.as_ref() {
        mgr.push_video_frame(&data, &source)
    } else {
        Err("Not in a voice channel".into())
    }
}

#[tauri::command]
pub async fn voice_mic_test_start(
    app: tauri::AppHandle,
    state: State<'_, MicTestState>,
    device_id: Option<String>,
    speaker_device_id: Option<String>,
) -> Result<(), String> {
    log::info!("voice_mic_test_start: mic={device_id:?}, speaker={speaker_device_id:?}");
    let mut guard = state.0.lock().await;
    // Stop any existing test
    if let Some(old) = guard.take() {
        log::info!("voice_mic_test_start: stopping previous test");
        old.stop();
    }
    let test = audio_io::MicTest::start(
        device_id.as_deref(),
        speaker_device_id.as_deref(),
        app,
    )
    .map_err(|e| {
        log::error!("voice_mic_test_start FAILED: {e}");
        e
    })?;
    log::info!("voice_mic_test_start: success, streams running");
    *guard = Some(test);
    Ok(())
}

#[tauri::command]
pub async fn voice_mic_test_stop(state: State<'_, MicTestState>) -> Result<(), String> {
    log::info!("voice_mic_test_stop called");
    let mut guard = state.0.lock().await;
    if let Some(test) = guard.take() {
        test.stop();
        log::info!("voice_mic_test_stop: stopped");
    }
    Ok(())
}
