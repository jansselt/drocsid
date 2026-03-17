export interface AudioOutputDevice {
  id: string;
  label: string;
  isDefault: boolean;
}

/**
 * Enumerate audio output devices using the browser API.
 */
export async function listAudioOutputs(): Promise<AudioOutputDevice[]> {
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
 * Enumerate audio input devices (microphones) using the browser API.
 */
export async function listAudioInputs(): Promise<AudioInputDevice[]> {
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

/**
 * Save microphone selection to localStorage and notify listeners.
 */
export function saveMicrophone(deviceId: string): void {
  localStorage.setItem('drocsid_mic', deviceId);
  window.dispatchEvent(new CustomEvent('drocsid-mic-changed'));
}

// ---------------------------------------------------------------------------
// Noise suppression preference
// ---------------------------------------------------------------------------

/**
 * Get noise suppression preference from localStorage.
 * Defaults to true (enabled) if never set.
 */
export function getNoiseSuppression(): boolean {
  return localStorage.getItem('drocsid_noise_suppression') !== 'false';
}

/**
 * Save noise suppression preference and notify listeners.
 */
export function saveNoiseSuppression(enabled: boolean): void {
  localStorage.setItem('drocsid_noise_suppression', String(enabled));
  window.dispatchEvent(new CustomEvent('drocsid-noise-suppression-changed'));
}

