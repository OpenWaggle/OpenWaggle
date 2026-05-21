import type { WaggleConsensusCheckResult } from '@shared/types/waggle'
import { describe, expect, it } from 'vitest'
import { checkConsensus } from '../consensus-detector'
import { msgs } from './consensus-detector.test-utils'

// ---------------------------------------------------------------------------
// checkConsensus
// ---------------------------------------------------------------------------

describe('checkConsensus', () => {
  // ── No signals ────────────────────────────────────────────────────────────

  describe('when messages are clearly different and turns are well below the limit', () => {
    it('returns reached: false with zero confidence', () => {
      const result: WaggleConsensusCheckResult = checkConsensus(
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
})
