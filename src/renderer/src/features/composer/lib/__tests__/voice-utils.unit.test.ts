import { describe, expect, it } from 'vitest'
import { downsampleAudio, toPcm16, trimSilence, WHISPER_TARGET_SAMPLE_RATE } from '../voice-utils'

describe('voice-utils', () => {
  it('keeps a copy when source and target sample rates match', () => {
    const source = new Float32Array([0.1, 0.2, 0.3])
    const result = downsampleAudio(source, WHISPER_TARGET_SAMPLE_RATE, WHISPER_TARGET_SAMPLE_RATE)

    expect(Array.from(result)).toEqual(Array.from(source))
    expect(result).not.toBe(source)
  })

  it('downsamples with linear interpolation', () => {
    const result = downsampleAudio(new Float32Array([0, 1, 0, -1]), 4, 2)

    expect(Array.from(result)).toEqual([0, 0])
  })

  it('trims leading and trailing silence while preserving padding', () => {
    const samples = new Float32Array([0, 0.001, 0.5, 0.25, 0.001, 0])
    const result = trimSilence(samples, 1000, 0.01, 1)

    expect(Array.from(result)).toEqual(Array.from(samples.slice(1, 5)))
  })

  it('keeps all samples when no audible range is detected', () => {
    const samples = new Float32Array([0, 0.001, 0])

    expect(trimSilence(samples, 1000, 0.01)).toBe(samples)
  })

  it('converts clamped floats to little-endian pcm16 bytes', () => {
    const bytes = toPcm16(new Float32Array([-2, -0.5, 0, 0.5, 2]))
    const view = new DataView(bytes.buffer)

    expect(view.getInt16(0, true)).toBe(-32768)
    expect(view.getInt16(2, true)).toBe(-16384)
    expect(view.getInt16(4, true)).toBe(0)
    expect(view.getInt16(6, true)).toBe(16384)
    expect(view.getInt16(8, true)).toBe(32767)
  })
})
