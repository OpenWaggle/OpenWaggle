import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { authorizeLocalSessionEvent } from '../local-session-event-authorization'

describe('local Session derived event authorization', () => {
  it('uses the refreshed connection snapshot after discovery capability is removed', async () => {
    const caller = {
      callerId: 'profile:worker-client',
      eventAdmissionSessionIds: ['session-worker'],
      profileAuthority: {
        profileId: 'worker-client',
        profileName: 'worker-client',
        capabilities: [],
        scope: { sessionIds: ['session-worker'] },
        authorizationCeiling: 'ask-for-approval',
      },
    } satisfies LocalSessionCallerIdentity
    const event = {
      cursor: { hostInstanceId: 'host', sequence: 1 },
      timestamp: 1,
      payload: {
        kind: 'session-state-changed' as const,
        sessionId: 'session-worker',
        stateRevision: 2,
        operation: 'interrupt',
      },
    }

    await expect(Effect.runPromise(authorizeLocalSessionEvent(caller, event))).resolves.toBe(false)
  })

  it('authorizes an exact child event from a derived read grant without mixing base scope', async () => {
    const caller = {
      callerId: 'profile:worker-client',
      eventAdmissionSessionIds: ['session-parent'],
      profileAuthority: {
        profileId: 'worker-client',
        profileName: 'worker-client',
        capabilities: ['sessions:discover'],
        scope: { sessionIds: ['session-parent'] },
        authorizationCeiling: 'ask-for-approval',
      },
      derivedSessionAuthorities: [
        {
          sessionId: 'session-worker',
          capabilities: ['sessions:read'],
          authorizationCeiling: 'ask-for-approval',
        },
      ],
    } satisfies LocalSessionCallerIdentity
    const event = {
      cursor: { hostInstanceId: 'host', sequence: 1 },
      timestamp: 1,
      payload: {
        kind: 'session-transport' as const,
        sessionId: 'session-worker',
        event: { type: 'agent_start' as const, runId: 'run-worker', timestamp: 1 },
      },
    }

    await expect(Effect.runPromise(authorizeLocalSessionEvent(caller, event))).resolves.toBe(true)
  })
})
