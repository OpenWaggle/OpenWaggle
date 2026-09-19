import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { SessionCapability } from '@shared/types/session-capability'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { authorizeLocalSessionCommand } from '../local-session-command-dispatcher'
import {
  authorizationLayer,
  controlPayload,
  queryPayload,
} from './local-session-command-dispatcher.test-support'

function derivedCaller(input: {
  readonly baseCapabilities: readonly SessionCapability[]
  readonly derivedCapabilities: readonly SessionCapability[]
  readonly expandedProfileScope?: boolean
}): LocalSessionCallerIdentity {
  return {
    callerId: 'profile:worker-client',
    baseProfileScope: { sessionIds: ['session-parent'] },
    derivedSessionAuthorities: [
      {
        sessionId: 'session-worker',
        capabilities: input.derivedCapabilities,
        authorizationCeiling: 'ask-for-approval',
      },
    ],
    profileAuthority: {
      profileId: 'worker-client',
      profileName: 'worker-client',
      capabilities: input.baseCapabilities,
      scope: {
        sessionIds: input.expandedProfileScope
          ? ['session-parent', 'session-worker']
          : ['session-parent'],
      },
      authorizationCeiling: 'ask-for-approval',
    },
  }
}

describe('Local Session derived command authorization', () => {
  it('accepts an exact child grant outside the profile base capability and scope', async () => {
    await expect(
      Effect.runPromise(
        authorizeLocalSessionCommand({
          caller: derivedCaller({
            baseCapabilities: ['sessions:discover'],
            derivedCapabilities: ['sessions:read'],
            expandedProfileScope: true,
          }),
          payload: queryPayload({ operation: 'read', sessionId: 'session-worker' }),
        }).pipe(Effect.provide(authorizationLayer)),
      ),
    ).resolves.toBeUndefined()
  })

  it.each([
    queryPayload({ operation: 'items', sessionId: 'session-worker', limit: 10 }),
    queryPayload({
      operation: 'wait',
      targets: [{ sessionId: 'session-worker', condition: 'idle' }],
      timeoutMs: 100,
    }),
  ])('jointly authorizes an exact derived read target for %#', async (payload) => {
    await expect(
      Effect.runPromise(
        authorizeLocalSessionCommand({
          caller: derivedCaller({
            baseCapabilities: ['sessions:discover'],
            derivedCapabilities: ['sessions:read'],
          }),
          payload,
        }).pipe(Effect.provide(authorizationLayer)),
      ),
    ).resolves.toBeUndefined()
  })

  it('jointly authorizes an exact derived control target', async () => {
    await expect(
      Effect.runPromise(
        authorizeLocalSessionCommand({
          caller: derivedCaller({
            baseCapabilities: ['sessions:discover'],
            derivedCapabilities: ['sessions:message'],
          }),
          payload: controlPayload({
            operation: 'message',
            sessionId: 'session-worker',
            input: { text: 'Continue.', attachmentIds: [] },
          }),
        }).pipe(Effect.provide(authorizationLayer)),
      ),
    ).resolves.toBeUndefined()
  })

  it('does not combine a base capability with an exact grant lacking that capability', async () => {
    await expect(
      Effect.runPromise(
        authorizeLocalSessionCommand({
          caller: derivedCaller({
            baseCapabilities: ['sessions:read'],
            derivedCapabilities: ['sessions:discover'],
            expandedProfileScope: true,
          }),
          payload: queryPayload({ operation: 'read', sessionId: 'session-worker' }),
        })
          .pipe(Effect.flip)
          .pipe(Effect.provide(authorizationLayer)),
      ),
    ).resolves.toMatchObject({ code: 'capability_denied' })
  })

  it('does not use an exact derived grant to authorize unscoped discovery', async () => {
    await expect(
      Effect.runPromise(
        authorizeLocalSessionCommand({
          caller: derivedCaller({
            baseCapabilities: ['sessions:read'],
            derivedCapabilities: ['sessions:discover'],
          }),
          payload: queryPayload({ operation: 'list', limit: 10 }),
        })
          .pipe(Effect.flip)
          .pipe(Effect.provide(authorizationLayer)),
      ),
    ).resolves.toMatchObject({ code: 'capability_denied', missing: ['sessions:discover'] })
  })
})
