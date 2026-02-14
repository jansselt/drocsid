// Notification sound system using Web Audio API
// Generates short tones programmatically — no external audio files needed.

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  // Resume if suspended (browsers require user gesture first)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume = 0.3,
) {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);

    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {
    // Audio not available — silently ignore
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
