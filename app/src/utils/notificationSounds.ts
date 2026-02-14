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

function getAudioContext(): AudioContext | null {
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

let notificationVolume = 0.5;

export function setNotificationVolume(vol: number) {
  notificationVolume = Math.max(0, Math.min(1, vol));
}

export function getNotificationVolume(): number {
  return notificationVolume;
}

function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
) {
  try {
    const ctx = getAudioContext();
    if (!ctx || ctx.state !== 'running') return;

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

function playChime(frequencies: number[], interval: number, duration: number) {
  frequencies.forEach((freq, i) => {
    setTimeout(() => playTone(freq, duration), i * interval);
  });
}

/** Two-note rising chime for new DM / message */
export function playMessageSound() {
  playChime([587, 784], 120, 0.15);
}

/** Higher pitched short ping for @mentions */
export function playMentionSound() {
  playChime([784, 988, 1175], 80, 0.12);
}

/** Low rising tone — someone joined voice */
export function playVoiceJoinSound() {
  playChime([392, 523], 150, 0.2);
}

/** Low falling tone — someone left voice */
export function playVoiceLeaveSound() {
  playChime([523, 392], 150, 0.2);
}
