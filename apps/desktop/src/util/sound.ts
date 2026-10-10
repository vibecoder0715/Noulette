/**
 * Studio Notification Sound Engine
 * Plays generated notification audio with Web Audio API real-time synthesis fallback.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Real-time harmonic synthesizer for notification alerts
 * Glassy 3-tone chime: E5 (659Hz) -> A5 (880Hz) -> E6 (1318Hz)
 */
function playSynthesizedChime(volumeRatio: number) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(Math.max(0.01, Math.min(1.0, volumeRatio)), now);
  masterGain.connect(ctx.destination);

  interface NoteDef {
    time: number;
    freq: number;
    decay: number;
    gain: number;
  }

  const chords: NoteDef[] = [
    // Tone 1: Warm intro ping (t = 0.0s)
    { time: 0.00, freq: 659.25, decay: 0.22, gain: 0.35 },
    { time: 0.00, freq: 987.77, decay: 0.18, gain: 0.20 },
    { time: 0.00, freq: 329.63, decay: 0.25, gain: 0.15 },

    // Tone 2: Ascending major lift (t = 0.09s)
    { time: 0.09, freq: 880.00, decay: 0.26, gain: 0.40 },
    { time: 0.09, freq: 1108.73, decay: 0.22, gain: 0.25 },
    { time: 0.09, freq: 1760.00, decay: 0.16, gain: 0.12 },

    // Tone 3: High clear chime sparkle (t = 0.20s)
    { time: 0.20, freq: 1318.51, decay: 0.45, gain: 0.50 },
    { time: 0.20, freq: 1975.53, decay: 0.35, gain: 0.25 },
    { time: 0.20, freq: 2637.02, decay: 0.28, gain: 0.15 },
    { time: 0.20, freq: 659.25,  decay: 0.40, gain: 0.20 }
  ];

  for (const n of chords) {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(n.freq, now + n.time);

    // Smooth 5ms attack and exponential decay
    const tStart = now + n.time;
    gainNode.gain.setValueAtTime(0.0001, tStart);
    gainNode.gain.linearRampToValueAtTime(n.gain, tStart + 0.006);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, tStart + n.decay);

    osc.connect(gainNode);
    gainNode.connect(masterGain);

    osc.start(tStart);
    osc.stop(tStart + n.decay + 0.05);
  }
}

let activeAudioElement: HTMLAudioElement | null = null;
type PlayStateListener = (playing: boolean) => void;
const listeners = new Set<PlayStateListener>();

export function subscribeToSoundState(listener: PlayStateListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifySoundState(playing: boolean) {
  listeners.forEach(fn => fn(playing));
}

/**
 * Plays the notification alert sound at the specified volume (0 to 100).
 */
export async function playNotificationSound(volumePercent: number = 80): Promise<boolean> {
  const volRatio = Math.max(0, Math.min(100, volumePercent)) / 100;
  if (volRatio === 0) return false;

  notifySoundState(true);

  try {
    if (typeof Audio !== 'undefined') {
      const audio = new Audio('/sounds/notification-alert.wav');
      audio.volume = volRatio;
      activeAudioElement = audio;

      audio.onended = () => {
        notifySoundState(false);
      };

      await audio.play();
      setTimeout(() => notifySoundState(false), 950);
      return true;
    }
  } catch (err) {
    // If HTML5 Audio is blocked by browser policies or missing, fall back to Web Audio API
  }

  try {
    playSynthesizedChime(volRatio);
    setTimeout(() => notifySoundState(false), 950);
    return true;
  } catch (synthErr) {
    console.error('Audio playback failed:', synthErr);
    notifySoundState(false);
    return false;
  }
}
