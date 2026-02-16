import { isTauri } from '../api/instance';

export interface AudioOutputDevice {
  id: string;
  label: string;
  isDefault: boolean;
}

/**
 * Enumerate audio output devices.
 * Tauri/Linux: uses cpal device enumeration (ALSA IDs).
 * Web: uses navigator.mediaDevices.enumerateDevices().
 */
export async function listAudioOutputs(): Promise<AudioOutputDevice[]> {
  if (isTauri()) {
    return listAudioOutputsTauri();
  }
  return listAudioOutputsWeb();
}

async function listAudioOutputsWeb(): Promise<AudioOutputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audiooutput')
      .map((d) => ({
        id: d.deviceId,
        label: d.label || `Speaker ${d.deviceId.slice(0, 8)}`,
        isDefault: d.deviceId === 'default',
      }));
  } catch {
    return [];
  }
}

async function listAudioOutputsTauri(): Promise<AudioOutputDevice[]> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const devices = await invoke<Array<{ id: string; name: string; is_default: boolean }>>('voice_list_output_devices');
    return devices.map((d) => ({
      id: d.id,
      label: d.name,
      isDefault: d.is_default,
    }));
  } catch (e) {
    console.warn('[audioDevices] Failed to list cpal output devices:', e);
    return [];
  }
}

/**
 * Route the app's audio streams to the given PulseAudio sink (Tauri/Linux only).
 */
export async function applyAudioOutputTauri(sinkName: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_audio_sink', { sinkName });
}

/**
 * Save speaker selection to localStorage and notify listeners.
 */
export function saveSpeaker(deviceId: string): void {
  localStorage.setItem('drocsid_speaker', deviceId);
  window.dispatchEvent(new CustomEvent('drocsid-speaker-changed'));
}

// ---------------------------------------------------------------------------
// Audio input (microphone / source) management
// ---------------------------------------------------------------------------

export interface AudioInputDevice {
  id: string;
  label: string;
  isDefault: boolean;
}

/**
 * Enumerate audio input devices (microphones).
 * Tauri/Linux: uses cpal device enumeration (ALSA IDs).
 * Web: uses navigator.mediaDevices.enumerateDevices().
 */
export async function listAudioInputs(): Promise<AudioInputDevice[]> {
  if (isTauri()) {
    return listAudioInputsTauri();
  }
  return listAudioInputsWeb();
}

async function listAudioInputsWeb(): Promise<AudioInputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({
        id: d.deviceId,
        label: d.label || `Microphone ${d.deviceId.slice(0, 8)}`,
        isDefault: d.deviceId === 'default',
      }));
  } catch {
    return [];
  }
}

async function listAudioInputsTauri(): Promise<AudioInputDevice[]> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const devices = await invoke<Array<{ id: string; name: string; is_default: boolean }>>('voice_list_input_devices');
    return devices.map((d) => ({
      id: d.id,
      label: d.name,
      isDefault: d.is_default,
    }));
  } catch (e) {
    console.warn('[audioDevices] Failed to list cpal input devices:', e);
    return [];
  }
}

/**
 * Label the app's PipeWire audio streams with distinct names (Tauri/Linux only).
 * Best-effort — silently does nothing when pw-cli is unavailable.
 */
export async function labelAudioStreamsTauri(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('label_audio_streams');
}

/**
 * Save microphone selection to localStorage and notify listeners.
 */
export function saveMicrophone(deviceId: string): void {
  localStorage.setItem('drocsid_mic', deviceId);
  window.dispatchEvent(new CustomEvent('drocsid-mic-changed'));
}
