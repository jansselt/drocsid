mod audio_io;
mod manager;

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

#[tauri::command]
pub async fn voice_connect(
    app: tauri::AppHandle,
    state: State<'_, VoiceState>,
    url: String,
    token: String,
    mic_device_id: Option<String>,
    speaker_device_id: Option<String>,
) -> Result<(), String> {
    let mut guard = state.0.lock().await;

    // Disconnect existing session if any
    if let Some(old) = guard.take() {
        old.disconnect().await;
    }

    let mgr = VoiceManager::connect(
        app,
        &url,
        &token,
        mic_device_id.as_deref(),
        speaker_device_id.as_deref(),
    )
    .await?;

    *guard = Some(mgr);
    Ok(())
}

#[tauri::command]
pub async fn voice_disconnect(state: State<'_, VoiceState>) -> Result<(), String> {
    let mut guard = state.0.lock().await;
    if let Some(mgr) = guard.take() {
        mgr.disconnect().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_set_mute(state: State<'_, VoiceState>, muted: bool) -> Result<(), String> {
    let guard = state.0.lock().await;
    if let Some(mgr) = guard.as_ref() {
        mgr.set_mute(muted);
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_set_deaf(state: State<'_, VoiceState>, deaf: bool) -> Result<(), String> {
    let guard = state.0.lock().await;
    if let Some(mgr) = guard.as_ref() {
        mgr.set_deaf(deaf);
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_set_user_volume(
    state: State<'_, VoiceState>,
    identity: String,
    volume_percent: u32,
) -> Result<(), String> {
    let guard = state.0.lock().await;
    if let Some(mgr) = guard.as_ref() {
        mgr.set_user_volume(&identity, volume_percent).await;
    }
    Ok(())
}

#[tauri::command]
pub fn voice_list_input_devices() -> Result<Vec<AudioDevice>, String> {
    audio_io::list_input_devices()
}

#[tauri::command]
pub fn voice_list_output_devices() -> Result<Vec<AudioDevice>, String> {
    audio_io::list_output_devices()
}
