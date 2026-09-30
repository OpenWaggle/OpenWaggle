import os from 'node:os'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { describe, expect, it } from 'vitest'
import {
  LocalSessionAuthenticationError,
  LocalSessionCommandAuthorizationError,
  SessionLifecyclePreparationError,
} from '../../errors'
import {
  LOCAL_SESSION_AUTHENTICATION_FAILED_MESSAGE,
  sessionCommandFailureMessage,
} from '../session-command-failure-message'

/** Reject the way the Sessions gateway does: through `Effect.runPromise`, as a FiberFailure. */
async function runPromiseFailure(effect: Effect.Effect<never, unknown>) {
  return Effect.runPromise(effect).then(
    () => {
      throw new Error('Expected the effect to fail.')
    },
    (failure: unknown) => failure,
  )
}

const USER_FACING_DETAIL_LIMIT = 600

describe('sessionCommandFailureMessage', () => {
  it('names an authorization refusal and what is missing', async () => {
    const failure = await runPromiseFailure(
      Effect.fail(
        new LocalSessionCommandAuthorizationError({
          code: 'capability_denied',
          missing: ['sessions:create'],
        }),
      ),
    )

    expect(sessionCommandFailureMessage(failure)).toBe(
      'Session command refused (capability_denied): the caller lacks a Session capability this operation requires. Missing capabilities: sessions:create.',
    )
  })

  it.each(['profile_not_found', 'profile_revoked', 'credential_rejected'] as const)(
    'does not turn the authentication code %s into a refusal reason',
    async (code) => {
      const failure = await runPromiseFailure(
        Effect.fail(new LocalSessionAuthenticationError({ code })),
      )

      expect(sessionCommandFailureMessage(failure)).toBe(
        LOCAL_SESSION_AUTHENTICATION_FAILED_MESSAGE,
      )
    },
  )

  it('reports a cancelled command instead of fiber ids', async () => {
    const fiber = Effect.runFork(Effect.never)
    const interrupted = Effect.runPromise(Fiber.join(fiber)).then(
      () => undefined,
      (failure: unknown) => failure,
    )
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(sessionCommandFailureMessage(await interrupted)).toBe('Session command was cancelled.')
  })

  it('shows only identifying fields of a structured cause, never [object Object]', async () => {
    const failure = await runPromiseFailure(
      Effect.fail(
        new SessionLifecyclePreparationError({
          operation: 'initiating-workspace-not-found',
          cause: { projectPath: '/projects/app', token: 'secret-token' },
        }),
      ),
    )

    const message = sessionCommandFailureMessage(failure)
    expect(message).toBe(
      'SessionLifecyclePreparationError (initiating-workspace-not-found): projectPath=/projects/app',
    )
    expect(message).not.toContain('secret-token')
  })

  it('redacts and bounds an error that carries its own message, and a defect', async () => {
    const long = sessionCommandFailureMessage(
      new Error(
        `${os.homedir()}/private token=abcdefghijklmnop ${'x'.repeat(USER_FACING_DETAIL_LIMIT)}`,
      ),
    )
    expect(long).toMatch(/^~\/private /)
    expect(long).not.toContain('abcdefghijklmnop')
    expect(long.length).toBeLessThanOrEqual(USER_FACING_DETAIL_LIMIT + 1)

    const defect = await runPromiseFailure(Effect.die(`${os.homedir()}/secret`))
    expect(sessionCommandFailureMessage(defect)).toBe('~/secret')
  })

  it('does not expose the fields of a bare-object defect', async () => {
    const defect = await runPromiseFailure(Effect.die({ apiKey: 'sk-secret' }))

    const message = sessionCommandFailureMessage(defect)
    expect(message).toBe('The Session Host could not complete the request.')
  })

  it('keeps an ordinary error message as it is', () => {
    expect(sessionCommandFailureMessage(new Error('Session not found.'))).toBe('Session not found.')
  })
})
