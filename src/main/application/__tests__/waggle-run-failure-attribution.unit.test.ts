import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { SessionProjectionRepositoryError } from '../../errors'
import { recoverWaggleRunFailure } from '../waggle-run/outcome'

const INPUT = {
  sessionId: 'session-1',
  runId: 'run-1',
  signal: new AbortController().signal,
} as const

/**
 * A Waggle run used to fail its Effect on any kernel error, so the invoke rejected and the caller learned nothing
 * about why. It could not tell a refusal it should report - a session whose worktree has gone - from a turn that
 * ran and then failed, and those need opposite handling for work submitted with the message: one must be kept,
 * the other must not be offered to the agent twice.
 */
describe('attributing a failed Waggle run', () => {
  it('reports a refusal when the agent never took the turn', async () => {
    const outcome = await Effect.runPromise(
      recoverWaggleRunFailure({
        error: new Error("This session's worktree no longer exists."),
        input: INPUT,
        reachedAgent: () => false,
      }),
    )

    expect(outcome.outcome).toBe('error')
    if (outcome.outcome !== 'error') throw new Error('Expected an error outcome')
    // No delivery marker: the caller keeps work it submitted, because the message never arrived.
    expect(outcome).not.toHaveProperty('transportEmitted')
    expect(outcome.message.length).toBeGreaterThan(0)
  })

  it('marks a failure after the agent answered, so the work is not offered twice', async () => {
    const outcome = await Effect.runPromise(
      recoverWaggleRunFailure({
        error: new Error('database is locked'),
        input: INPUT,
        reachedAgent: () => true,
      }),
    )

    expect(outcome).toMatchObject({ outcome: 'error', transportEmitted: true })
  })

  it('classifies a cause wrapped in a generic error, as the classic path does', async () => {
    const outcome = await Effect.runPromise(
      recoverWaggleRunFailure({
        error: new Error('request failed', { cause: new Error('429 Too Many Requests') }),
        input: INPUT,
        reachedAgent: () => true,
      }),
    )

    expect(outcome).toMatchObject({ outcome: 'error', code: 'rate-limited' })
  })

  // ADR 0037 applies to Waggle as well as classic runs.
  it('reports a Waggle snapshot that could not be saved as a persistence failure', async () => {
    const outcome = await Effect.runPromise(
      recoverWaggleRunFailure({
        error: new SessionProjectionRepositoryError({
          operation: 'persistSessionSnapshot',
          cause: new Error('disk I/O error'),
        }),
        input: INPUT,
        reachedAgent: () => true,
      }),
    )

    expect(outcome).toMatchObject({
      outcome: 'error',
      code: 'persist-failed',
      message: 'SessionProjectionRepositoryError (persistSessionSnapshot) <- Error: disk I/O error',
      transportEmitted: true,
    })
  })
})
