// Audio and voice processing configuration.

import { DOUBLE_FACTOR } from './constants'

/** Audio sample rate constraints */
export const AUDIO_SAMPLE_RATE = {
  MIN_HZ: 8_000,
  MAX_HZ: 48_000,
} as const

/** Audio recording limits */
export const AUDIO_RECORDING = {
  /** Maximum audio duration in seconds */
  MAX_SECONDS: 90,
  /** Max PCM16 buffer size in bytes (maxSampleRate * maxSeconds * 2) */
  MAX_PCM16_BYTES: AUDIO_SAMPLE_RATE.MAX_HZ * 90 * DOUBLE_FACTOR,
  /** Audio chunk length in seconds */
  CHUNK_LENGTH_S: 10,
  /** Audio stride length in seconds */
  STRIDE_LENGTH_S: 2,
} as const

/** Language code validation */
export const LANGUAGE_CODE = {
  MIN_LENGTH: 2,
  MAX_LENGTH: 16,
} as const
