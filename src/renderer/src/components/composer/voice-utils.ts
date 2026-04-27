import { DOUBLE_FACTOR } from '@shared/constants/math'
import { TIME_UNIT } from '@shared/constants/time'

const DEFAULT_SILENCE_THRESHOLD = 0.012
const DEFAULT_SILENCE_PADDING_MS = 160
const PCM16_NEGATIVE_SCALE = 32768
const PCM16_POSITIVE_SCALE = 32767

export const WHISPER_TARGET_SAMPLE_RATE = 16_000

interface DecodedAudioBuffer {
  durationSeconds: number
  sampleRate: number
  samples: Float32Array
}

function toMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return new Float32Array(buffer.getChannelData(0))
  const mono = new Float32Array(buffer.length)
  const weight = 1 / buffer.numberOfChannels
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel)
    for (let index = 0; index < samples.length; index += 1) {
      mono[index] += samples[index] * weight
    }
  }
  return mono
}

export function downsampleAudio(
  samples: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array {
  if (sourceRate === targetRate) return new Float32Array(samples)
  const ratio = sourceRate / targetRate
  const length = Math.max(1, Math.round(samples.length / ratio))
  const downsampled = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    const sourceIndex = index * ratio
    const lowIndex = Math.floor(sourceIndex)
    const highIndex = Math.min(samples.length - 1, lowIndex + 1)
    const t = sourceIndex - lowIndex
    downsampled[index] = samples[lowIndex] * (1 - t) + samples[highIndex] * t
  }
  return downsampled
}

export async function decodeAudioBlob(blob: Blob): Promise<DecodedAudioBuffer> {
  const audioContext = new AudioContext()
  try {
    const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer())
    return {
      durationSeconds: decoded.duration,
      sampleRate: decoded.sampleRate,
      samples: toMono(decoded),
    }
  } finally {
    await audioContext.close().catch(() => undefined)
  }
}

export function trimSilence(
  samples: Float32Array,
  sampleRate: number,
  threshold = DEFAULT_SILENCE_THRESHOLD,
  paddingMs = DEFAULT_SILENCE_PADDING_MS,
): Float32Array {
  if (samples.length === 0) return samples
  let startIndex = 0
  while (startIndex < samples.length && Math.abs(samples[startIndex]) < threshold) startIndex += 1
  let endIndex = samples.length - 1
  while (endIndex > startIndex && Math.abs(samples[endIndex]) < threshold) endIndex -= 1
  if (startIndex >= endIndex) return samples
  const paddingSamples = Math.round((paddingMs / TIME_UNIT.MILLISECONDS_PER_SECOND) * sampleRate)
  return samples.slice(
    Math.max(0, startIndex - paddingSamples),
    Math.min(samples.length, endIndex + paddingSamples),
  )
}

export function toPcm16(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * DOUBLE_FACTOR)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(
      index * DOUBLE_FACTOR,
      sample < 0
        ? Math.round(sample * PCM16_NEGATIVE_SCALE)
        : Math.round(sample * PCM16_POSITIVE_SCALE),
      true,
    )
  }
  return bytes
}
