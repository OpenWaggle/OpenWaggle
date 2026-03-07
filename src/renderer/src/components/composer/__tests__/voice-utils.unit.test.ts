import { describe, expect, it } from 'vitest'
import { buildPeakEnvelope, extractLivePeak } from '../voice-utils'

describe('voice-utils', () => {
  it('buildPeakEnvelope is deterministic and bounded', () => {
    const samples = new Float32Array([0, 0.12, -0.8, 0.4, -0.25, 0.91, 0.2, -0.1])

    const first = buildPeakEnvelope(samples, 4)
    const second = buildPeakEnvelope(samples, 4)

    expect(first).toEqual(second)
    expect(first).toHaveLength(4)
    expect(first.every((value) => value >= 0.04 && value <= 1)).toBe(true)
  })

  it('buildPeakEnvelope handles empty input gracefully', () => {
    expect(buildPeakEnvelope(new Float32Array([]), 6)).toEqual([0.04, 0.04, 0.04, 0.04, 0.04, 0.04])
  })

  it('extractLivePeak returns a bounded floor value for silence', () => {
    const silence = new Uint8Array(32).fill(128)

    expect(extractLivePeak(silence)).toBe(0.04)
  })
})
