import { describe, expect, it } from 'vitest'
import { checkConsensus } from '../consensus-detector'
import { msgs } from './consensus-detector.test-utils'

describe('checkConsensus response convergence signals', () => {
  describe('shrinking response detection', () => {
    it('emits a signal when current message is less than 40% of previous length', () => {
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
      const current =
        'The retry logic looks correct. Exponential backoff is implemented and the circuit breaker threshold is five failures.'

      const result = checkConsensus(msgs(previous, current), 2, 10)

      const shrinkSignal = result.signals.find(
        (s) => s.type === 'no-new-information' && s.confidence === 0.6,
      )
      expect(shrinkSignal).toBeUndefined()
    })
  })

  describe('turn limit soft signal', () => {
    it('emits a turn-limit signal when totalTurns > 75% of maxTurns', () => {
      const result = checkConsensus(
        msgs(
          'We have covered most of the ground on this refactoring task.',
          'I think we are still diverging on the module structure.',
        ),
        8,
        10,
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
        10,
      )

      const signal = result.signals.find((s) => s.type === 'turn-limit')
      expect(signal).toBeUndefined()
    })

    it('turn-limit signal alone (confidence 0.5) does not reach consensus', () => {
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
})
