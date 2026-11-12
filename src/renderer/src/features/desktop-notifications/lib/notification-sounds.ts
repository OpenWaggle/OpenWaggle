import type {
  BundledNotificationSoundId,
  NotificationSoundId,
} from '@shared/types/desktop-notification'

/** What the Notification sound picker calls each choice. */
export const NOTIFICATION_SOUND_LABELS: Readonly<Record<NotificationSoundId, string>> = {
  chime: 'Chime',
  bell: 'Bell',
  pop: 'Pop',
  glass: 'Glass',
  pulse: 'Pulse',
  'low-tone': 'Low tone',
  system: 'System default',
  none: 'None',
}

interface Tone {
  /** Seconds after the sound starts. */
  readonly at: number
  readonly frequency: number
  readonly duration: number
  readonly type: OscillatorType
  readonly gain: number
  /** Where the pitch ends, for a slide. */
  readonly slideTo?: number
}

/**
 * The bundled Notification sounds, synthesized so the app ships no audio files. Each is short
 * and quiet enough to repeat without startling.
 */
const SOUND_TONES: Readonly<Record<BundledNotificationSoundId, readonly Tone[]>> = {
  chime: [
    { at: 0, frequency: 880, duration: 0.35, type: 'sine', gain: 0.18 },
    { at: 0.12, frequency: 1318.5, duration: 0.5, type: 'sine', gain: 0.14 },
  ],
  bell: [
    { at: 0, frequency: 1046.5, duration: 0.9, type: 'triangle', gain: 0.16 },
    { at: 0, frequency: 2093, duration: 0.5, type: 'sine', gain: 0.05 },
  ],
  pop: [{ at: 0, frequency: 520, duration: 0.12, type: 'sine', gain: 0.22, slideTo: 880 }],
  glass: [
    { at: 0, frequency: 1567.98, duration: 0.6, type: 'sine', gain: 0.12 },
    { at: 0.08, frequency: 2093, duration: 0.7, type: 'sine', gain: 0.08 },
  ],
  pulse: [
    { at: 0, frequency: 660, duration: 0.09, type: 'square', gain: 0.06 },
    { at: 0.16, frequency: 660, duration: 0.09, type: 'square', gain: 0.06 },
  ],
  'low-tone': [
    { at: 0, frequency: 392, duration: 0.28, type: 'triangle', gain: 0.2 },
    { at: 0.22, frequency: 293.66, duration: 0.45, type: 'triangle', gain: 0.2 },
  ],
}

/** Seconds: a short lead so the first tone is scheduled, the attack, and the tail after release. */
const START_LEAD_SECONDS = 0.01
const ATTACK_SECONDS = 0.01
const STOP_TAIL_SECONDS = 0.02
/** Exponential ramps cannot reach zero; this is silent. */
const SILENT_GAIN = 0.0001

let audioContext: AudioContext | null = null

function context() {
  audioContext ??= new AudioContext()
  return audioContext
}

/** Play a bundled Notification sound now; a failure (no audio device) stays silent. */
export async function playNotificationSound(sound: BundledNotificationSoundId) {
  const audio = context()
  if (audio.state === 'suspended') await audio.resume()
  const start = audio.currentTime + START_LEAD_SECONDS
  for (const tone of SOUND_TONES[sound]) {
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    const at = start + tone.at
    oscillator.type = tone.type
    oscillator.frequency.setValueAtTime(tone.frequency, at)
    if (tone.slideTo) {
      oscillator.frequency.exponentialRampToValueAtTime(tone.slideTo, at + tone.duration)
    }
    gain.gain.setValueAtTime(SILENT_GAIN, at)
    gain.gain.exponentialRampToValueAtTime(tone.gain, at + ATTACK_SECONDS)
    gain.gain.exponentialRampToValueAtTime(SILENT_GAIN, at + tone.duration)
    oscillator.connect(gain).connect(audio.destination)
    oscillator.start(at)
    oscillator.stop(at + tone.duration + STOP_TAIL_SECONDS)
  }
}
