import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { describe, expect, it } from 'vitest'
import { resolveSessionHostProjectPolicy } from '../session-host-policy'

describe('Session Host project policy', () => {
  it('uses project-specific parent capacity and multi-agent selection when present', () => {
    expect(
      resolveSessionHostProjectPolicy(
        {
          ...DEFAULT_SETTINGS,
          sessionHostParentConcurrencyLimit: 8,
          sessionHostParentConcurrencyLimitsByProject: { '/project': 32 },
          sessionHostRunCeiling: 64,
          multiAgentEnabled: true,
          multiAgentEnabledByProject: { '/project': false },
        },
        '/project',
      ),
    ).toEqual({
      parentConcurrencyLimit: 32,
      hostRunCeiling: 64,
      idleGracePeriodMs: DEFAULT_SETTINGS.sessionHostIdleGracePeriodMs,
      modelMultiAgentEnabled: false,
    })
  })

  it('falls back to global policy for a project without overrides', () => {
    expect(resolveSessionHostProjectPolicy(DEFAULT_SETTINGS, '/project')).toEqual({
      parentConcurrencyLimit: 4,
      hostRunCeiling: 16,
      idleGracePeriodMs: 300_000,
      modelMultiAgentEnabled: true,
    })
  })
})
