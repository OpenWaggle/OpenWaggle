import { DEFAULT_SESSION_AGENT_CAPABILITIES } from '@shared/types/session-capability'
import type { SessionLifecycleCommand } from '@shared/types/session-lifecycle'
import { describe, expect, it } from 'vitest'
import { resolveLifecycleSessionCapabilities } from '../session-lifecycle-execution-profile'

const CREATE: SessionLifecycleCommand = { operation: 'create', projectPath: '/repo' }
const PROFILE = { modelId: 'openai/gpt-5.5', thinkingLevel: 'high' as const }

describe('the Session capabilities a new Session persists', () => {
  it('stores none for a desktop-created root, so it reads as the current default grant', () => {
    expect(
      resolveLifecycleSessionCapabilities({ command: CREATE, profile: PROFILE }),
    ).toBeUndefined()
  })

  it('holds a root an agent or access profile creates to what that caller had', () => {
    const caller = DEFAULT_SESSION_AGENT_CAPABILITIES.filter(
      (capability) => capability !== 'schedules:manage',
    )

    expect(
      resolveLifecycleSessionCapabilities({
        command: CREATE,
        profile: PROFILE,
        callerCapabilities: caller,
      }),
    ).toEqual(caller)
    expect(
      resolveLifecycleSessionCapabilities({
        command: CREATE,
        profile: { ...PROFILE, sessionCapabilities: ['sessions:read', 'schedules:read'] },
        callerCapabilities: DEFAULT_SESSION_AGENT_CAPABILITIES,
      }),
    ).toEqual(['sessions:read', 'schedules:read'])
  })
})
