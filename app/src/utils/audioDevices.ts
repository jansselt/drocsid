import { isTauri } from '../api/instance';

export interface AudioOutputDevice {
  id: string;
  label: string;
  isDefault: boolean;
}

/**
 * Enumerate audio output devices.
 * Tauri/Linux: enumerates PulseAudio/PipeWire sinks via pactl.
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
    const [sinks, defaultSink] = await Promise.all([
      invoke<Array<{ name: string; description: string; index: number }>>('list_audio_sinks'),
      invoke<string>('get_default_audio_sink'),
    ]);
    return sinks.map((s) => ({
      id: s.name,
      label: s.description,
      isDefault: s.name === defaultSink,
    }));
  } catch (e) {
    console.warn('[audioDevices] Failed to list Tauri audio sinks:', e);
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
 * Tauri/Linux: enumerates PipeWire/PulseAudio sources via pactl.
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
    const [sources, defaultSource] = await Promise.all([
      invoke<Array<{ name: string; description: string; index: number }>>('list_audio_sources'),
      invoke<string>('get_default_audio_source'),
    ]);
    return sources.map((s) => ({
      id: s.name,
      label: s.description,
      isDefault: s.name === defaultSource,
    }));
  } catch (e) {
    console.warn('[audioDevices] Failed to list Tauri audio sources:', e);
    return [];
  }
}

/**
 * Route the app's recording streams to the given PipeWire/PulseAudio source (Tauri/Linux only).
 */
export async function applyAudioInputTauri(sourceName: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_audio_source', { sourceName });
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
 * Create a virtual PipeWire null-sink ("Drocsid Voice Sound In") that appears
 * in qpwgraph / Helvum / pavucontrol. The user can route any mic to it.
 * The app's recording stream is automatically moved to the sink's monitor.
 */
export async function createVoiceInputSink(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('create_voice_input_sink');
}

/**
 * Get the current PipeWire/PulseAudio default audio source name (Tauri/Linux only).
 */
export async function getDefaultAudioSourceTauri(): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('get_default_audio_source');
}

/**
 * Set the PipeWire/PulseAudio default audio source (Tauri/Linux only).
 * Used to point getUserMedia at the virtual sink's monitor before connecting.
 */
export async function setDefaultAudioSourceTauri(sourceName: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_default_audio_source', { sourceName });
}

/**
 * Remove the virtual mic input sink (on voice disconnect / app exit).
 */
export async function destroyVoiceInputSink(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('destroy_voice_input_sink');
}

/**
 * Save microphone selection to localStorage and notify listeners.
 */
export function saveMicrophone(deviceId: string): void {
  localStorage.setItem('drocsid_mic', deviceId);
  window.dispatchEvent(new CustomEvent('drocsid-mic-changed'));
}
