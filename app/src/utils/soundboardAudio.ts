// Soundboard audio playback engine
// Uses Web Audio API with preloaded AudioBuffers for instant playback.
// Listens for 'drocsid-soundboard-play' CustomEvents dispatched by the store.

import { getAudioContext } from './notificationSounds';
import type { SoundboardSound, SoundboardPlayEvent } from '../types';

const VOLUME_KEY = 'drocsid_soundboard_volume';

const audioCache = new Map<string, AudioBuffer>();

let soundboardVolume = (() => {
  try {
    const stored = localStorage.getItem(VOLUME_KEY);
    if (stored !== null) return Math.max(0, Math.min(1, parseFloat(stored)));
  } catch { /* */ }
  return 0.5;
})();

export function setSoundboardVolume(vol: number) {
  soundboardVolume = Math.max(0, Math.min(1, vol));
  try { localStorage.setItem(VOLUME_KEY, String(soundboardVolume)); } catch { /* */ }
}

export function getSoundboardVolume(): number {
  return soundboardVolume;
}

/** Preload sounds into AudioBuffer cache for instant playback. */
export async function preloadSounds(sounds: SoundboardSound[]): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) return;

  await Promise.allSettled(
    sounds.map(async (sound) => {
      if (audioCache.has(sound.audio_url)) return;
      try {
        const response = await fetch(sound.audio_url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        audioCache.set(sound.audio_url, audioBuffer);
      } catch (e) {
        console.warn('[soundboard] Failed to preload:', sound.name, e);
      }
    }),
  );
}

/** Play a sound immediately. Uses cached AudioBuffer if available, falls back to HTMLAudioElement. */
export function playSound(audioUrl: string, soundVolume: number): void {
  const effectiveVolume = soundVolume * soundboardVolume;
  if (effectiveVolume === 0) return;

  const ctx = getAudioContext();
  const buffer = audioCache.get(audioUrl);

  if (ctx && ctx.state === 'running' && buffer) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = effectiveVolume;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    return;
  }

  // Fallback: play via HTMLAudioElement (slower, no preload)
  const audio = new Audio(audioUrl);
  audio.volume = effectiveVolume;
  audio.play().catch(() => {});
}

/** Measure duration of an audio file (for upload validation). Returns duration in milliseconds. */
export async function measureAudioDuration(file: File): Promise<number> {
  const ctx = new AudioContext();
  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    return Math.round(audioBuffer.duration * 1000);
  } finally {
    ctx.close();
  }
}

/**
 * Initialize soundboard playback listener.
 * Listens for 'drocsid-soundboard-play' CustomEvents and plays the sound.
 * Pass a function that returns whether the user is currently deafened.
 * Returns cleanup function.
 */
export function initSoundboardPlayback(
  isDeafened: () => boolean,
): () => void {
  const handler = (e: Event) => {
    if (isDeafened()) return;
    const { audio_url, volume } = (e as CustomEvent<SoundboardPlayEvent>).detail;
    playSound(audio_url, volume);
  };
  window.addEventListener('drocsid-soundboard-play', handler);
  return () => window.removeEventListener('drocsid-soundboard-play', handler);
}
