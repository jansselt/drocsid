// Notification sound system using Web Audio API
// Generates short tones programmatically — no external audio files needed.
//
// IMPORTANT: Call initAudio() from a user gesture (click/keydown) to unlock
// audio playback. Browsers suspend AudioContext until a user gesture occurs.

let audioCtx: AudioContext | null = null;

/**
 * Initialize and unlock the audio context. Must be called from a user gesture
 * handler (click, keydown, etc.) to satisfy browser autoplay policies.
 * Safe to call multiple times — only the first successful call matters.
 */
export function initAudio(): void {
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  } catch (e) {
    console.warn('[notificationSounds] Failed to initialize AudioContext:', e);
  }
}

export function getAudioContext(): AudioContext | null {
  if (!audioCtx) {
    // Lazy fallback — but context will likely be suspended without user gesture
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Async version that awaits resume() before returning.
 * Used by playTone so sounds work even when the tab is backgrounded
 * and the AudioContext has been suspended by the browser.
 */
async function getAudioContextReady(): Promise<AudioContext | null> {
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') {
    try {
      await audioCtx.resume();
    } catch {
      return null;
    }
  }
  return audioCtx.state === 'running' ? audioCtx : null;
}

const VOLUME_KEY = 'drocsid:notification-volume';
const SOUND_THEME_KEY = 'drocsid:notification-sound-theme';

export type SoundTheme = 'classic' | 'soft' | 'pop' | 'bell' | 'none';

export const SOUND_THEME_LABELS: Record<SoundTheme, string> = {
  classic: 'Classic',
  soft: 'Soft',
  pop: 'Pop',
  bell: 'Bell',
  none: 'None',
};

let currentTheme: SoundTheme = (() => {
  try {
    const stored = localStorage.getItem(SOUND_THEME_KEY);
    if (stored && stored in SOUND_THEME_LABELS) return stored as SoundTheme;
  } catch { /* */ }
  return 'classic';
})();

export function getSoundTheme(): SoundTheme {
  return currentTheme;
}

export function setSoundTheme(theme: SoundTheme) {
  currentTheme = theme;
  try { localStorage.setItem(SOUND_THEME_KEY, theme); } catch { /* */ }
}

let notificationVolume = (() => {
  try {
    const stored = localStorage.getItem(VOLUME_KEY);
    if (stored !== null) return Math.max(0, Math.min(1, parseFloat(stored)));
  } catch { /* localStorage unavailable */ }
  return 0.5;
})();

export function setNotificationVolume(vol: number) {
  notificationVolume = Math.max(0, Math.min(1, vol));
  try { localStorage.setItem(VOLUME_KEY, String(notificationVolume)); } catch { /* */ }
}

export function getNotificationVolume(): number {
  return notificationVolume;
}

async function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
) {
  try {
    const ctx = await getAudioContextReady();
    if (!ctx) return;

    const vol = notificationVolume;
    if (vol === 0) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);

    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    console.warn('[notificationSounds] playTone failed:', e);
  }
}

function playChime(frequencies: number[], interval: number, duration: number, wave: OscillatorType = 'sine') {
  frequencies.forEach((freq, i) => {
    setTimeout(() => playTone(freq, duration, wave), i * interval);
  });
}

// ── Sound theme definitions ──────────────────────────
// Each theme defines [frequencies, interval, duration, waveform] for each sound type.

type ChimeDef = [number[], number, number, OscillatorType?];

const themes: Record<Exclude<SoundTheme, 'none'>, {
  message: ChimeDef;
  mention: ChimeDef;
  voiceJoin: ChimeDef;
  voiceLeave: ChimeDef;
}> = {
  classic: {
    message:    [[587, 784], 120, 0.15],
    mention:    [[784, 988, 1175], 80, 0.12],
    voiceJoin:  [[392, 523], 150, 0.2],
    voiceLeave: [[523, 392], 150, 0.2],
  },
  soft: {
    message:    [[440], 0, 0.25],
    mention:    [[523, 659], 140, 0.2],
    voiceJoin:  [[330, 440], 180, 0.25],
    voiceLeave: [[440, 330], 180, 0.25],
  },
  pop: {
    message:    [[880, 1047], 60, 0.08, 'triangle'],
    mention:    [[1047, 1319, 1568], 50, 0.07, 'triangle'],
    voiceJoin:  [[523, 784], 80, 0.1, 'triangle'],
    voiceLeave: [[784, 523], 80, 0.1, 'triangle'],
  },
  bell: {
    message:    [[1175, 880], 100, 0.3, 'sine'],
    mention:    [[1319, 1568, 1760], 90, 0.25, 'sine'],
    voiceJoin:  [[523, 659, 784], 120, 0.3, 'sine'],
    voiceLeave: [[784, 659, 523], 120, 0.3, 'sine'],
  },
};

function playThemed(key: 'message' | 'mention' | 'voiceJoin' | 'voiceLeave') {
  if (currentTheme === 'none') return;
  const def = themes[currentTheme][key];
  playChime(def[0], def[1], def[2], def[3]);
}

/** Notification sound for new messages / DMs */
export function playMessageSound() {
  playThemed('message');
}

/** Higher pitched sound for @mentions */
export function playMentionSound() {
  playThemed('mention');
}

/** Rising tone — someone joined voice */
export function playVoiceJoinSound() {
  playThemed('voiceJoin');
}

/** Falling tone — someone left voice */
export function playVoiceLeaveSound() {
  playThemed('voiceLeave');
}
