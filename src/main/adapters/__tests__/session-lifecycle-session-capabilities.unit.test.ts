import {
  DEFAULT_SESSION_AGENT_CAPABILITIES,
  type SessionCapability,
} from '@shared/types/session-capability'
import type { SessionLifecycleCommand } from '@shared/types/session-lifecycle'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { DEFAULT_BEFORE_SCHEDULED_TASKS } from '../../domain/session-control/session-capability-restriction'
import { resolveLifecycleSessionCapabilities } from '../session-lifecycle-execution-profile'
import { decodeSessionExecutionProfile } from '../session-run-execution-profile'

const CREATE: SessionLifecycleCommand = { operation: 'create', projectPath: '/repo' }
const FORK: SessionLifecycleCommand = { operation: 'fork', sourceSessionId: 'source' }
const SPAWN: SessionLifecycleCommand = {
  operation: 'spawn',
  parentSessionId: 'parent',
  expectedParentRunId: 'run-parent',
  delegation: fromPartial({ objective: 'Review the change' }),
}
const PROFILE = { modelId: 'openai/gpt-5.5', thinkingLevel: 'high' as const }

const WITHOUT_SCHEDULES = DEFAULT_SESSION_AGENT_CAPABILITIES.filter(
  (capability) => !capability.startsWith('schedules:'),
)
const WITHOUT_MANAGE = DEFAULT_SESSION_AGENT_CAPABILITIES.filter(
  (capability) => capability !== 'schedules:manage',
)

/**
 * What the next Run of the new Session reads back: the persisted profile decoded, as the Host
 * decodes it, and the default agent grant narrowed to its list.
 */
function readBack(input: Parameters<typeof resolveLifecycleSessionCapabilities>[0]) {
  const sessionCapabilities = resolveLifecycleSessionCapabilities(input)
  const decoded = decodeSessionExecutionProfile(
    JSON.stringify({ ...PROFILE, ...(sessionCapabilities ? { sessionCapabilities } : {}) }),
  )
  const list = decoded.sessionCapabilities
  return {
    persisted: sessionCapabilities,
    effective: list
      ? DEFAULT_SESSION_AGENT_CAPABILITIES.filter((capability) => list.includes(capability))
      : DEFAULT_SESSION_AGENT_CAPABILITIES,
  }
}

function withList(sessionCapabilities: readonly SessionCapability[]) {
  return { ...PROFILE, sessionCapabilities }
}

describe('the Session capabilities a new Session persists and its Runs read back', () => {
  it('stores none for a root the person or a caller with the whole default grant creates', () => {
    expect(readBack({ command: CREATE, profile: PROFILE })).toEqual({
      persisted: undefined,
      effective: DEFAULT_SESSION_AGENT_CAPABILITIES,
    })
    expect(
      readBack({
        command: CREATE,
        profile: PROFILE,
        callerCapabilities: DEFAULT_SESSION_AGENT_CAPABILITIES,
      }).persisted,
    ).toBeUndefined()
  })

  it('holds a root a narrower caller creates to what that caller had, and never widens it', () => {
    expect(
      readBack({ command: CREATE, profile: PROFILE, callerCapabilities: WITHOUT_MANAGE }),
    ).toEqual({ persisted: WITHOUT_MANAGE, effective: WITHOUT_MANAGE })
    // A caller holding the default grant before Scheduled tasks, such as a legacy Session's agent.
    expect(
      readBack({
        command: CREATE,
        profile: PROFILE,
        callerCapabilities: DEFAULT_BEFORE_SCHEDULED_TASKS,
      }).effective,
    ).toEqual(DEFAULT_BEFORE_SCHEDULED_TASKS)
  })

  it("keeps an agent definition's list as an allowlist, even when it names the whole default", () => {
    expect(
      readBack({
        command: CREATE,
        profile: withList(WITHOUT_SCHEDULES),
        callerCapabilities: DEFAULT_SESSION_AGENT_CAPABILITIES,
      }),
    ).toEqual({ persisted: WITHOUT_SCHEDULES, effective: WITHOUT_SCHEDULES })
    expect(
      readBack({ command: CREATE, profile: withList(DEFAULT_SESSION_AGENT_CAPABILITIES) })
        .persisted,
    ).toEqual(DEFAULT_SESSION_AGENT_CAPABILITIES)
    expect(
      readBack({
        command: CREATE,
        profile: withList(['sessions:read', 'schedules:read']),
        callerCapabilities: WITHOUT_MANAGE,
      }).persisted,
    ).toEqual(['sessions:read', 'schedules:read'])
  })

  it('copies the restriction of the Session a fork or a Worker comes from', () => {
    expect(readBack({ command: FORK, profile: withList(WITHOUT_MANAGE) }).effective).toEqual(
      WITHOUT_MANAGE,
    )
    expect(readBack({ command: SPAWN, profile: withList(WITHOUT_SCHEDULES) }).persisted).toEqual(
      WITHOUT_SCHEDULES,
    )
    expect(
      readBack({
        command: SPAWN,
        profile: PROFILE,
        callerCapabilities: ['sessions:read'],
      }).persisted,
    ).toBeUndefined()
  })
})
