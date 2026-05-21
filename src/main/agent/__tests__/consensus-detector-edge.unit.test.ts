import { describe, expect, it } from 'vitest'
import { checkConsensus } from '../consensus-detector'
import { msgs } from './consensus-detector.test-utils'

describe('checkConsensus edge cases and aggregation', () => {
  describe('edge cases', () => {
    it('handles empty string messages without throwing', () => {
      expect(() => checkConsensus(msgs('', ''), 1, 10)).not.toThrow()

      const result = checkConsensus(msgs('', ''), 1, 10)
      expect(result.reached).toBe(false)
    })

    it('handles single-word messages without throwing', () => {
      expect(() => checkConsensus(msgs('yes', 'no'), 1, 10)).not.toThrow()

      const result = checkConsensus(msgs('yes', 'no'), 1, 10)
      expect(result.reached).toBe(false)
    })

    it('handles whitespace-only messages without throwing', () => {
      expect(() => checkConsensus(msgs('   ', '   '), 1, 10)).not.toThrow()
    })

    it('confidence is rounded to two decimal places', () => {
      const result = checkConsensus(msgs('Yes.', 'I agree.'), 1, 10)

      const decimalPlaces = (result.confidence.toString().split('.')[1] ?? '').length
      expect(decimalPlaces).toBeLessThanOrEqual(2)
    })

    it('returns the correct shape when consensus is reached', () => {
      const result = checkConsensus(
        msgs(
          'The analysis is thorough and covers all the requirements.',
          'Agreed, no further changes needed.',
        ),
        2,
        10,
      )

      expect(result).toMatchObject({
        reached: expect.any(Boolean),
        confidence: expect.any(Number),
        reason: expect.any(String),
        signals: expect.any(Array),
      })
    })
  })

  describe('signal aggregation', () => {
    it('averages confidence across multiple signals', () => {
      const result = checkConsensus(
        msgs(
          'The solution is complete and covers all the requirements we discussed in the planning session.',
          'I agree. Everything looks good here.',
        ),
        9,
        10,
      )

      expect(result.signals.length).toBeGreaterThanOrEqual(2)
      expect(result.reached).toBe(true)
    })

    it('uses the highest-confidence signal reason when consensus is reached', () => {
      const result = checkConsensus(
        msgs(
          'The solution is complete and covers all the requirements we discussed in the planning session.',
          'I agree. Everything looks good here.',
        ),
        9,
        10,
      )

      expect(result.reached).toBe(true)
      expect(result.reason).toContain('agreement')
    })
  })
})
