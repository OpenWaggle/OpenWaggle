import os from 'node:os'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { describe, expect, it } from 'vitest'
import {
  LocalSessionAuthenticationError,
  LocalSessionCommandAuthorizationError,
  LocalSessionProfileRepositoryError,
  SessionLifecyclePreparationError,
} from '../../errors'
import { LocalSessionAuthenticationBudgetError } from '../local-session-resource-policy'
import {
  LOCAL_SESSION_AUTHENTICATION_FAILED_MESSAGE,
  localSessionAuthenticationFailureMessage,
  sessionCommandFailureMessage,
} from '../session-command-failure-message'

/** Reject the way the Sessions gateway does: through `Effect.runPromise`, as a FiberFailure. */
async function runPromiseFailure(error: unknown) {
  return Effect.runPromise(Effect.fail(error)).then(
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
      new LocalSessionCommandAuthorizationError({
        code: 'capability_denied',
        missing: ['sessions:create'],
      }),
    )

    expect(sessionCommandFailureMessage(failure)).toBe(
      'Session command refused (capability_denied): the caller lacks a Session capability this operation requires. Missing capabilities: sessions:create.',
    )
  })

  it.each(['profile_not_found', 'profile_revoked', 'credential_rejected'] as const)(
    'does not turn the authentication code %s into a refusal reason',
    async (code) => {
      const failure = await runPromiseFailure(new LocalSessionAuthenticationError({ code }))

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

  it('omits a plain-object cause instead of printing [object Object]', async () => {
    const failure = await runPromiseFailure(
      new SessionLifecyclePreparationError({
        operation: 'initiating-workspace-not-found',
        cause: { projectPath: '/projects/private', workingDirectory: '/projects/private/wt' },
      }),
    )

    const message = sessionCommandFailureMessage(failure)
    expect(message).toBe('SessionLifecyclePreparationError (initiating-workspace-not-found)')
    expect(message).not.toContain('/projects/private')
  })

  it('redacts the home directory and bounds a long cause chain', async () => {
    const failure = await runPromiseFailure(
      new LocalSessionProfileRepositoryError({
        operation: 'load',
        cause: new Error(`${os.homedir()}/secret-path ${'x'.repeat(USER_FACING_DETAIL_LIMIT * 2)}`),
      }),
    )

    const message = sessionCommandFailureMessage(failure)
    expect(message).toMatch(/^LocalSessionProfileRepositoryError \(load\) <- Error: ~\/secret-path/)
    expect(message.length).toBeLessThanOrEqual(USER_FACING_DETAIL_LIMIT + 1)
  })

  it('keeps an ordinary error message as it is', () => {
    expect(sessionCommandFailureMessage(new Error('Session not found.'))).toBe('Session not found.')
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

    const defect = await Effect.runPromise(Effect.die(`${os.homedir()}/secret`)).then(
      () => undefined,
      (failure: unknown) => failure,
    )
    expect(sessionCommandFailureMessage(defect)).toBe('~/secret')
  })

  it('does not print a bare-object defect as [object Object] or expose its fields', async () => {
    const defect = await Effect.runPromise(Effect.die({ projectPath: '/projects/private' })).then(
      () => undefined,
      (failure: unknown) => failure,
    )
    const message = sessionCommandFailureMessage(defect)
    expect(message).toBe(
      'Session command failed unexpectedly. The Session Host log has the details.',
    )
  })
})

describe('localSessionAuthenticationFailureMessage', () => {
  it.each(['profile_not_found', 'profile_revoked', 'credential_rejected'] as const)(
    'gives %s the same message so profile names cannot be probed',
    (code) => {
      expect(
        localSessionAuthenticationFailureMessage(new LocalSessionAuthenticationError({ code })),
      ).toBe(LOCAL_SESSION_AUTHENTICATION_FAILED_MESSAGE)
    },
  )

  it('hides a repository failure behind the same message', () => {
    expect(
      localSessionAuthenticationFailureMessage(
        new LocalSessionProfileRepositoryError({
          operation: 'authenticate',
          cause: new Error('db'),
        }),
      ),
    ).toBe(LOCAL_SESSION_AUTHENTICATION_FAILED_MESSAGE)
  })

  it('keeps the text of an admission-budget refusal', () => {
    expect(
      localSessionAuthenticationFailureMessage(
        new LocalSessionAuthenticationBudgetError(
          'Local Session authentication is temporarily throttled.',
        ),
      ),
    ).toBe('Local Session authentication is temporarily throttled.')
  })

  it('hides an untagged error from the profile lookup, such as a corrupt profile row', () => {
    expect(
      localSessionAuthenticationFailureMessage(new SyntaxError('Unexpected token in JSON')),
    ).toBe(LOCAL_SESSION_AUTHENTICATION_FAILED_MESSAGE)
  })
})
