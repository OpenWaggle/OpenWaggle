import { DOUBLE_FACTOR } from '@shared/constants/math'
import { TIME_UNIT } from '@shared/constants/time'

const DEFAULT_SILENCE_THRESHOLD = 0.012
const DEFAULT_SILENCE_PADDING_MS = 160
const PCM16_NEGATIVE_SCALE = 32768
const PCM16_POSITIVE_SCALE = 32767
const PCM_LEVEL_MIDPOINT = 128
const MIN_PEAK_LEVEL = 0.04
const LIVE_LEVEL_GAIN = 1.85
const ENVELOPE_LEVEL_GAIN = 1.3

export const WHISPER_TARGET_SAMPLE_RATE = 16_000

interface DecodedAudioBuffer {
  durationSeconds: number
  sampleRate: number
  samples: Float32Array
}

function clampPeak(value: number): number {
  return Math.max(MIN_PEAK_LEVEL, Math.min(1, value))
}

export function toMono(buffer: AudioBuffer): Float32Array {
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

export function extractLivePeak(data: Uint8Array<ArrayBufferLike>): number {
  if (data.length === 0) return MIN_PEAK_LEVEL
  let sum = 0
  let max = 0
  for (let index = 0; index < data.length; index += 1) {
    const normalized = (data[index] - PCM_LEVEL_MIDPOINT) / PCM_LEVEL_MIDPOINT
    const magnitude = Math.abs(normalized)
    sum += normalized * normalized
    if (magnitude > max) max = magnitude
  }
  const rms = Math.sqrt(sum / data.length)
  const blended = Math.max(max, rms * LIVE_LEVEL_GAIN)
  return clampPeak(blended)
}

export function seedPeaks(capacity: number): readonly number[] {
  return Array.from({ length: Math.max(0, capacity) }, () => MIN_PEAK_LEVEL)
}

export function buildPeakEnvelope(
  samples: Float32Array,
  bucketCount: number,
  gain = ENVELOPE_LEVEL_GAIN,
): readonly number[] {
  if (bucketCount <= 0) return []
  if (samples.length === 0) return seedPeaks(bucketCount)
  const peaks = new Array<number>(bucketCount).fill(MIN_PEAK_LEVEL)
  const bucketSize = Math.max(1, Math.floor(samples.length / bucketCount))
  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const startIndex = bucketIndex * bucketSize
    const endIndex =
      bucketIndex === bucketCount - 1
        ? samples.length
        : Math.min(samples.length, startIndex + bucketSize)
    let max = 0
    for (let sampleIndex = startIndex; sampleIndex < endIndex; sampleIndex += 1) {
      const magnitude = Math.abs(samples[sampleIndex])
      if (magnitude > max) max = magnitude
    }
    peaks[bucketIndex] = clampPeak(max * gain)
  }
  return peaks
}
