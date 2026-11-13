import { DEFAULT_SESSION_AGENT_CAPABILITIES } from '@shared/types/session-capability'
import { describe, expect, it } from 'vitest'
import { type StoredSessionGrant, sessionsHoldingOnlyADefaultGrant } from '../default-grant-restore'
import { DEFAULT_BEFORE_SCHEDULED_TASKS } from '../session-capability-restriction'

const SINCE = 1_000

function grant(sessionId: string, overrides: Partial<StoredSessionGrant> = {}): StoredSessionGrant {
  return {
    sessionId,
    createdAt: SINCE + 1,
    localUserOrigin: true,
    capabilities: DEFAULT_BEFORE_SCHEDULED_TASKS,
    definitionChoseCapabilities: false,
    ...overrides,
  }
}

describe('the Sessions whose stored grant only held a default grant', () => {
  it('follows the older grant through any number of copies, and through a cycle safely', () => {
    const restored = sessionsHoldingOnlyADefaultGrant({
      grants: [grant('queen', { createdAt: 0 }), grant('a'), grant('b'), grant('c'), grant('d')],
      sources: [
        { sessionId: 'a', sourceSessionId: 'queen' },
        { sessionId: 'b', sourceSessionId: 'a' },
        { sessionId: 'c', sourceSessionId: 'b' },
        // d and e copy each other and nothing restored: neither is a default grant.
        { sessionId: 'd', sourceSessionId: 'e' },
        { sessionId: 'e', sourceSessionId: 'd' },
      ],
      scheduledTasksSince: SINCE,
    })

    expect([...restored].sort()).toEqual(['a', 'b', 'c', 'queen'])
  })

  it('restores nothing by age when it cannot tell when Scheduled tasks were installed', () => {
    expect(
      sessionsHoldingOnlyADefaultGrant({
        grants: [
          grant('queen', { createdAt: 0 }),
          grant('desktop', { capabilities: DEFAULT_SESSION_AGENT_CAPABILITIES }),
        ],
        sources: [],
        scheduledTasksSince: undefined,
      }),
    ).toEqual(['desktop'])
  })

  it('finds a definition upstream even through a cycle in the history', () => {
    const whole = { capabilities: DEFAULT_SESSION_AGENT_CAPABILITIES }
    expect(
      sessionsHoldingOnlyADefaultGrant({
        grants: [
          grant('a', whole),
          grant('b', whole),
          grant('d', { ...whole, definitionChoseCapabilities: true }),
        ],
        sources: [
          { sessionId: 'a', sourceSessionId: 'b' },
          { sessionId: 'a', sourceSessionId: 'd' },
          { sessionId: 'b', sourceSessionId: 'a' },
        ],
        scheduledTasksSince: SINCE,
      }),
    ).toEqual([])
  })

  it('never restores a list an access profile wrote or a definition chose upstream', () => {
    expect(
      sessionsHoldingOnlyADefaultGrant({
        grants: [
          grant('profile', { createdAt: 0, localUserOrigin: false }),
          grant('defined', { createdAt: 0, definitionChoseCapabilities: true }),
          grant('child', { createdAt: 0 }),
        ],
        sources: [{ sessionId: 'child', sourceSessionId: 'defined' }],
        scheduledTasksSince: SINCE,
      }),
    ).toEqual([])
  })
})
