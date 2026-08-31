import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'
import { describe, expect, it } from 'vitest'
import { createLocalSessionEventAdmissionFilter } from '../local-session-event-admission'

const TRANSPORT_EVENT: SessionHostEventEnvelope = {
  cursor: { hostInstanceId: 'host', sequence: 1 },
  timestamp: 1,
  payload: {
    kind: 'session-transport',
    sessionId: 'worker-session',
    event: { type: 'agent_start', runId: 'run-worker', timestamp: 1 },
  },
}

describe('Local Session event admission', () => {
  it('admits a Worker event when its derived authority grants the required capability', () => {
    const admit = createLocalSessionEventAdmissionFilter(() => ({
      callerId: 'profile:queen',
      profileAuthority: {
        profileId: 'queen',
        profileName: 'queen',
        capabilities: ['sessions:discover'],
        scope: { sessionIds: ['queen-session'] },
        authorizationCeiling: 'ask-for-approval',
      },
      eventAdmissionSessionIds: ['queen-session', 'worker-session'],
      derivedSessionAuthorities: [
        {
          sessionId: 'worker-session',
          capabilities: ['sessions:read'],
          authorizationCeiling: 'ask-for-approval',
        },
      ],
    }))

    expect(admit(TRANSPORT_EVENT)).toBe(true)
  })

  it('rejects the same event when neither base nor derived authority grants read access', () => {
    const admit = createLocalSessionEventAdmissionFilter(() => ({
      callerId: 'profile:queen',
      profileAuthority: {
        profileId: 'queen',
        profileName: 'queen',
        capabilities: ['sessions:discover'],
        scope: { sessionIds: ['worker-session'] },
        authorizationCeiling: 'ask-for-approval',
      },
      eventAdmissionSessionIds: ['worker-session'],
    }))

    expect(admit(TRANSPORT_EVENT)).toBe(false)
  })

  it('does not combine base read capability with a discovery-only derived target', () => {
    const admit = createLocalSessionEventAdmissionFilter(() => ({
      callerId: 'profile:queen',
      profileAuthority: {
        profileId: 'queen',
        profileName: 'queen',
        capabilities: ['sessions:read'],
        scope: { sessionIds: ['queen-session'] },
        authorizationCeiling: 'ask-for-approval',
      },
      eventAdmissionSessionIds: ['queen-session'],
      derivedSessionAuthorities: [
        {
          sessionId: 'worker-session',
          capabilities: ['sessions:discover'],
          authorizationCeiling: 'ask-for-approval',
        },
      ],
    }))

    expect(admit(TRANSPORT_EVENT)).toBe(false)
  })
})
