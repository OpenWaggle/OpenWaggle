import type { ConsensusCheckResult } from '@shared/types/multi-agent'
import { describe, expect, it } from 'vitest'
import { checkConsensus } from '../consensus-detector'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a pair of representative messages.  Keeps test declarations concise.
 */
function msgs(prev: string, curr: string): readonly [string, string] {
  return [prev, curr] as const
}

// ---------------------------------------------------------------------------
// checkConsensus
// ---------------------------------------------------------------------------

describe('checkConsensus', () => {
  // ── No signals ────────────────────────────────────────────────────────────

  describe('when messages are clearly different and turns are well below the limit', () => {
    it('returns reached: false with zero confidence', () => {
      const result: ConsensusCheckResult = checkConsensus(
        msgs(
          'We should refactor the database layer to use a repository pattern.',
          'I think we need to focus on the UI performance issues first before touching the backend.',
        ),
        2,
        10,
      )

      expect(result.reached).toBe(false)
      expect(result.confidence).toBe(0)
      expect(result.signals).toHaveLength(0)
      expect(result.reason).toBe('No consensus signals detected')
    })
  })

  // ── Layer 1: Explicit agreement phrases ──────────────────────────────────

  describe('explicit agreement detection', () => {
    it('detects "i agree" and returns reached: true', () => {
      const result = checkConsensus(
        msgs(
          'The solution looks correct to me. We should add more tests.',
          'I agree with your analysis. The tests would definitely improve coverage.',
        ),
        3,
        10,
      )

      expect(result.reached).toBe(true)
      expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      const signal = result.signals.find((s) => s.type === 'explicit-agreement')
      expect(signal).toBeDefined()
      expect(signal?.confidence).toBe(0.9)
    })

    it('detects "looks good" phrase', () => {
      const result = checkConsensus(
        msgs(
          'Here is my implementation of the authentication module.',
          'Looks good to me. The implementation covers all the edge cases.',
        ),
        4,
        10,
      )

      expect(result.reached).toBe(true)
      const signal = result.signals.find((s) => s.type === 'explicit-agreement')
      expect(signal).toBeDefined()
    })

    it('detects "lgtm" phrase', () => {
      const result = checkConsensus(
        msgs(
          'I have reviewed all the changes and updated the documentation.',
          'LGTM. The changes look correct and well-structured.',
        ),
        5,
        10,
      )

      expect(result.reached).toBe(true)
      const signal = result.signals.find((s) => s.type === 'explicit-agreement')
      expect(signal).toBeDefined()
    })

    it('detects "nothing to add" phrase', () => {
      const result = checkConsensus(
        msgs(
          'The architecture decision looks solid. The layered approach separates concerns well.',
          'Nothing to add here. The analysis covers every relevant trade-off.',
        ),
        2,
        10,
      )

      expect(result.reached).toBe(true)
      const signal = result.signals.find((s) => s.type === 'explicit-agreement')
      expect(signal).toBeDefined()
    })

    it('detects "no further changes" phrase', () => {
      const result = checkConsensus(
        msgs(
          'All the edge cases in the validator are now handled properly.',
          'No further changes needed.',
        ),
        3,
        10,
      )

      expect(result.reached).toBe(true)
    })

    it('detects "no objections" phrase', () => {
      const result = checkConsensus(
        msgs(
          'The pull request description has been updated with the new scope.',
          'No objections from my side.',
        ),
        2,
        10,
      )

      expect(result.reached).toBe(true)
    })

    it('is case-insensitive', () => {
      const result = checkConsensus(
        msgs('Here is the updated plan.', 'SOUNDS GOOD, let us proceed with that approach.'),
        2,
        10,
      )

      expect(result.reached).toBe(true)
      const signal = result.signals.find((s) => s.type === 'explicit-agreement')
      expect(signal).toBeDefined()
    })

    it('gives low confidence when agreement phrase appears in a long message', () => {
      // Long messages that start with "I agree" but have substantial new content
      // are acknowledging a point, not declaring full consensus.
      const longResponse =
        'I agree with the general direction, but there are several important caveats we need to address. ' +
        'First, the database migration strategy needs a rollback plan that accounts for the foreign key constraints. ' +
        'Second, the caching layer should use a write-through pattern rather than write-behind to prevent stale reads. ' +
        'Third, we need to add circuit breakers around the external payment API calls since they have a 2% timeout rate. ' +
        'Fourth, the authentication flow should support token refresh without forcing a full re-login. ' +
        'Finally, the monitoring setup needs distributed tracing to debug cross-service latency issues effectively.'

      const result = checkConsensus(
        msgs('Here is my proposed architecture for the payment system.', longResponse),
        3,
        10,
      )

      const signal = result.signals.find((s) => s.type === 'explicit-agreement')
      expect(signal).toBeDefined()
      expect(signal?.confidence).toBe(0.5)
      // Low confidence (0.5) alone does not reach the 0.7 threshold
      expect(result.reached).toBe(false)
    })

    it('does not fire on partial substring that is not an agreement phrase', () => {
      // "ship" is not "ship it" and "agree" alone is not in the phrase list
      const result = checkConsensus(
        msgs(
          'We have to agree to disagree on the styling conventions.',
          'I disagree. The codebase would benefit from stricter linting rules.',
        ),
        2,
        10,
      )

      const explicitSignal = result.signals.find((s) => s.type === 'explicit-agreement')
      expect(explicitSignal).toBeUndefined()
    })
  })

  // ── Layer 2: Content similarity (Jaccard) ─────────────────────────────────

  describe('content similarity detection', () => {
    it('returns a no-new-information signal when messages share substantial content', () => {
      // Construct two messages that are nearly identical so Jaccard > 0.6
      const sharedBody =
        'The refactoring is complete. We have extracted the utility functions. The tests pass. The documentation has been updated.'
      const result = checkConsensus(msgs(sharedBody, `${sharedBody} One minor note added.`), 3, 10)

      const signal = result.signals.find((s) => s.type === 'no-new-information')
      expect(signal).toBeDefined()
      expect(signal?.confidence).toBe(0.7)
    })

    it('does not fire when messages have low word overlap', () => {
      const result = checkConsensus(
        msgs(
          'The frontend rendering pipeline requires attention. React profiling shows excessive re-renders on the sidebar component.',
          'Backend latency is the primary bottleneck. Database connection pooling is misconfigured and needs tuning.',
        ),
        2,
        10,
      )

      const signal = result.signals.find((s) => s.type === 'no-new-information')
      expect(signal).toBeUndefined()
    })

    it('does not fire when either message produces no extractable sentences', () => {
      // Sentences must be > 10 chars to be extracted; short messages produce no sentences.
      const result = checkConsensus(msgs('ok.', 'ok.'), 2, 10)

      const signal = result.signals.find((s) => s.type === 'no-new-information')
      expect(signal).toBeUndefined()
    })
  })

  // ── Layer 3: Shrinking response ───────────────────────────────────────────

  describe('shrinking response detection', () => {
    it('emits a signal when current message is less than 40% of previous length', () => {
      // previous > 100 chars; current < 40% of previous
      const previous =
        'The implementation covers unit tests for all public methods, integration tests for the database layer, and end-to-end tests for the critical user flows. Coverage is at 87 percent.'
      const current = 'Agreed, looks solid.'

      const result = checkConsensus(msgs(previous, current), 3, 10)

      const signal = result.signals.find(
        (s) => s.type === 'no-new-information' && s.confidence === 0.6,
      )
      expect(signal).toBeDefined()
      expect(signal?.reason).toContain('shorter')
    })

    it('does not fire when previous message is 100 chars or fewer', () => {
      const previous =
        'Short previous message that is right at the boundary of one hundred characters here!'
      // previous.length <= 100 so the check is skipped
      const current = 'Ok.'

      const result = checkConsensus(msgs(previous, current), 2, 10)

      const shrinkSignal = result.signals.find(
        (s) => s.type === 'no-new-information' && s.confidence === 0.6,
      )
      expect(shrinkSignal).toBeUndefined()
    })

    it('does not fire when current message is empty', () => {
      const previous =
        'The architecture document has been updated to reflect the new microservice boundaries and the event-driven communication model.'

      const result = checkConsensus(msgs(previous, ''), 2, 10)

      const shrinkSignal = result.signals.find(
        (s) => s.type === 'no-new-information' && s.confidence === 0.6,
      )
      expect(shrinkSignal).toBeUndefined()
    })

    it('does not fire when current is 40% or more of previous length', () => {
      const previous =
        'The service now handles retries with exponential backoff. Each failure increments a counter and the circuit breaker opens after five consecutive failures.'
      // current is about 60% of previous length — should NOT trigger
      const current =
        'The retry logic looks correct. Exponential backoff is implemented and the circuit breaker threshold is five failures.'

      const result = checkConsensus(msgs(previous, current), 2, 10)

      const shrinkSignal = result.signals.find(
        (s) => s.type === 'no-new-information' && s.confidence === 0.6,
      )
      expect(shrinkSignal).toBeUndefined()
    })
  })

  // ── Layer 4: Turn limit soft signal ──────────────────────────────────────

  describe('turn limit soft signal', () => {
    it('emits a turn-limit signal when totalTurns > 75% of maxTurns', () => {
      const result = checkConsensus(
        msgs(
          'We have covered most of the ground on this refactoring task.',
          'I think we are still diverging on the module structure.',
        ),
        8,
        10, // 8 > 10 * 0.75 = 7.5
      )

      const signal = result.signals.find((s) => s.type === 'turn-limit')
      expect(signal).toBeDefined()
      expect(signal?.confidence).toBe(0.5)
      expect(signal?.reason).toContain('8')
      expect(signal?.reason).toContain('10')
    })

    it('does not emit a turn-limit signal when totalTurns <= 75% of maxTurns', () => {
      const result = checkConsensus(
        msgs(
          'We have covered most of the ground on this refactoring task.',
          'I think we are still diverging on the module structure.',
        ),
        7,
        10, // 7 = 10 * 0.7 which is NOT > 0.75 threshold
      )

      const signal = result.signals.find((s) => s.type === 'turn-limit')
      expect(signal).toBeUndefined()
    })

    it('turn-limit signal alone (confidence 0.5) does not reach consensus', () => {
      // Only turn-limit fires: avg confidence = 0.5 which is below the 0.7 threshold
      const result = checkConsensus(
        msgs(
          'We still have differing views on how the caching strategy should work in production.',
          'I believe the cache invalidation policy is the critical open question remaining.',
        ),
        8,
        10,
      )

      const signal = result.signals.find((s) => s.type === 'turn-limit')
      expect(signal).toBeDefined()
      expect(result.reached).toBe(false)
      expect(result.confidence).toBe(0.5)
      expect(result.reason).toBe('Insufficient consensus signals')
    })
  })

  // ── Edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty string messages without throwing', () => {
      expect(() => checkConsensus(msgs('', ''), 1, 10)).not.toThrow()

      const result = checkConsensus(msgs('', ''), 1, 10)
      expect(result.reached).toBe(false)
    })

    it('handles single-word messages without throwing', () => {
      expect(() => checkConsensus(msgs('yes', 'no'), 1, 10)).not.toThrow()

      const result = checkConsensus(msgs('yes', 'no'), 1, 10)
      // Single words produce no extractable sentences (all < 10 chars), so only
      // explicit-agreement could fire — "yes" / "no" are not agreement phrases.
      expect(result.reached).toBe(false)
    })

    it('handles whitespace-only messages without throwing', () => {
      expect(() => checkConsensus(msgs('   ', '   '), 1, 10)).not.toThrow()
    })

    it('confidence is rounded to two decimal places', () => {
      // Trigger only the explicit-agreement signal (confidence 0.9) with
      // messages that are short enough to avoid the similarity / shrinking checks.
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

  // ── Signal aggregation ────────────────────────────────────────────────────

  describe('signal aggregation', () => {
    it('averages confidence across multiple signals', () => {
      // Force multiple signals: explicit-agreement (0.9) + turn-limit (0.5)
      // avg = (0.9 + 0.5) / 2 = 0.7
      const result = checkConsensus(
        msgs(
          'The solution is complete and covers all the requirements we discussed in the planning session.',
          'I agree. Everything looks good here.',
        ),
        9,
        10, // near turn limit triggers turn-limit signal
      )

      expect(result.signals.length).toBeGreaterThanOrEqual(2)
      // With at least explicit-agreement (0.9) the average must be >= 0.7
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
      // The reason should come from the explicit-agreement signal (highest confidence)
      expect(result.reason).toContain('agreement')
    })
  })
})
