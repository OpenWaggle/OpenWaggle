import type { Settings } from '@shared/types/settings'

export interface SessionHostProjectPolicy {
  readonly parentConcurrencyLimit: number
  readonly hostRunCeiling: number
  readonly idleGracePeriodMs: number
  readonly modelMultiAgentEnabled: boolean
}

export function resolveSessionHostProjectPolicy(
  settings: Settings,
  projectPath: string,
  projectOverride?: {
    readonly multiAgentEnabled?: boolean
    readonly parentConcurrencyLimit?: number
  },
): SessionHostProjectPolicy {
  return {
    parentConcurrencyLimit:
      projectOverride?.parentConcurrencyLimit ??
      settings.sessionHostParentConcurrencyLimitsByProject[projectPath] ??
      settings.sessionHostParentConcurrencyLimit,
    hostRunCeiling: settings.sessionHostRunCeiling,
    idleGracePeriodMs: settings.sessionHostIdleGracePeriodMs,
    modelMultiAgentEnabled:
      projectOverride?.multiAgentEnabled ??
      settings.multiAgentEnabledByProject[projectPath] ??
      settings.multiAgentEnabled,
  }
}
