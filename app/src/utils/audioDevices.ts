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
