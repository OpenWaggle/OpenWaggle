import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
  MAX_RUN_INITIATOR_CHAIN_DEPTH,
  MAX_RUN_INITIATOR_CHAIN_HOPS,
} from '../../domain/session-control/root-session-project-reach'
import { type RunReference, walkRunInitiators } from '../run-initiator-walk'

/** A catalog of Runs by `runId`: each one's own verdict and the Runs it follows. */
type Catalog = Record<
  string,
  { readonly sessionId: string; readonly verdict: boolean; readonly follows: readonly string[] }
>

function decide(catalog: Catalog, runId: string) {
  const steps: string[] = []
  const reference = (id: string): RunReference => {
    const run = catalog[id]
    if (!run) throw new Error(`No Run ${id} in the test catalog`)
    return { sessionId: run.sessionId, runId: id }
  }
  const verdict = Effect.runSync(
    walkRunInitiators(
      {
        step: (run) =>
          Effect.sync(() => {
            steps.push(run.runId)
            const entry = catalog[run.runId]
            return entry
              ? { verdict: entry.verdict, followRuns: entry.follows.map(reference) }
              : { verdict: false, followRuns: [] }
          }),
        combine: (verdicts) => verdicts.every((value) => value),
        failClosed: false,
      },
      reference(runId),
    ),
  )
  return { verdict, steps }
}

/** `r0` ... `r<length - 1>`, each following the previous one, all passing on their own. */
function line(length: number, sessionOf: (index: number) => string, prefix = 'r'): Catalog {
  return Object.fromEntries(
    Array.from({ length }, (_, index) => [
      `${prefix}${index}`,
      {
        sessionId: sessionOf(index),
        verdict: true,
        follows: index === 0 ? [] : [`${prefix}${index - 1}`],
      },
    ]),
  )
}

const alternating = (index: number) => (index % 2 === 0 ? 'a' : 'b')

describe('walkRunInitiators', () => {
  it('reads each Run once when every Run follows the previous one twice', () => {
    const hops = 12
    const catalog: Catalog = Object.fromEntries(
      Array.from({ length: hops + 1 }, (_, index) => [
        `r${index}`,
        {
          sessionId: alternating(index),
          verdict: true,
          // Initiator and author are both the previous Run: 2^12 visits without shared verdicts.
          follows: index === 0 ? [] : [`r${index - 1}`, `r${index - 1}`],
        },
      ]),
    )

    const { verdict, steps } = decide(catalog, `r${hops}`)

    expect(verdict).toBe(true)
    expect(steps).toHaveLength(hops + 1)
  })

  it('allows a path of exactly the Run limit and fails closed one Run past it', () => {
    const limit = MAX_RUN_INITIATOR_CHAIN_HOPS
    expect(decide(line(limit, alternating), `r${limit - 1}`).verdict).toBe(true)
    expect(decide(line(limit + 1, alternating), `r${limit}`).verdict).toBe(false)
  })

  it.each([
    ['short branch first', ['short', 'long']],
    ['long branch first', ['long', 'short']],
  ])(
    'fails closed on a Run reached past the limit, whichever branch comes first (%s)',
    (_label, order) => {
      const limit = MAX_RUN_INITIATOR_CHAIN_HOPS
      // `shared1` is two Runs deep. `short` reaches it at once; `long` reaches it with one Run of
      // budget left, so the path through `long` is one Run past the limit.
      const longRuns = limit - 2
      const catalog: Catalog = {
        ...line(2, () => 'a', 'shared'),
        ...line(longRuns, alternating, 'long'),
        short: { sessionId: 'a', verdict: true, follows: ['shared1'] },
        top: {
          sessionId: 'b',
          verdict: true,
          follows: order.map((branch) => (branch === 'short' ? 'short' : `long${longRuns - 1}`)),
        },
      }
      const long0 = catalog.long0
      if (!long0) throw new Error('The long branch has a first Run')
      catalog.long0 = { ...long0, follows: ['shared1'] }

      expect(decide(catalog, 'top').verdict).toBe(false)
    },
  )

  it('fails closed when the tree spans more than the Session limit, even across branches', () => {
    const others = MAX_RUN_INITIATOR_CHAIN_DEPTH
    // Each branch alone stays within the limit; together they span one Session too many.
    const firstHalf = Math.ceil(others / 2)
    const branch = (name: string, from: number, count: number): Catalog =>
      line(count, (index) => `s${from + index}`, name)
    const catalog: Catalog = {
      ...branch('x', 1, firstHalf),
      ...branch('y', 1 + firstHalf, others + 1 - firstHalf),
      top: {
        sessionId: 's0',
        verdict: true,
        follows: [`x${firstHalf - 1}`, `y${others - firstHalf}`],
      },
    }

    expect(decide(catalog, 'top').verdict).toBe(false)
  })

  it('fails closed when any Run in the tree fails, and stops reading there', () => {
    const catalog: Catalog = {
      ...line(3, alternating),
      denied: { sessionId: 'c', verdict: false, follows: ['r2'] },
      top: { sessionId: 'a', verdict: true, follows: ['denied', 'r2'] },
    }

    const { verdict, steps } = decide(catalog, 'top')

    expect(verdict).toBe(false)
    expect(steps).toEqual(['top', 'denied'])
  })
})
