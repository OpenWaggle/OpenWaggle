import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import {
  SETTINGS_KEY_MULTI_AGENT_ENABLED,
  SETTINGS_KEY_MULTI_AGENT_ENABLED_BY_PROJECT,
  SETTINGS_KEY_SESSION_HOST_IDLE_GRACE_PERIOD_MS,
  SETTINGS_KEY_SESSION_HOST_PARENT_CONCURRENCY_LIMIT,
  SETTINGS_KEY_SESSION_HOST_PARENT_CONCURRENCY_LIMITS_BY_PROJECT,
  SETTINGS_KEY_SESSION_HOST_RUN_CEILING,
} from './keys'
import { isObjectRecord } from './sanitizers'

function resolvePositiveSafeInteger(raw: unknown, fallback: number) {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 ? raw : fallback
}

function resolveSessionHostParentConcurrencyLimit(raw: unknown) {
  return resolvePositiveSafeInteger(raw, DEFAULT_SETTINGS.sessionHostParentConcurrencyLimit)
}

function resolveSessionHostRunCeiling(raw: unknown) {
  return resolvePositiveSafeInteger(raw, DEFAULT_SETTINGS.sessionHostRunCeiling)
}

function resolveSessionHostIdleGracePeriodMs(raw: unknown) {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0
    ? raw
    : DEFAULT_SETTINGS.sessionHostIdleGracePeriodMs
}

function resolveMultiAgentEnabled(raw: unknown) {
  return typeof raw === 'boolean' ? raw : DEFAULT_SETTINGS.multiAgentEnabled
}

function sanitizePositiveIntegerByProject(raw: unknown) {
  if (!isObjectRecord(raw)) return {}
  const result: Record<string, number> = {}
  for (const [rawProjectPath, value] of Object.entries(raw)) {
    const projectPath = rawProjectPath.trim()
    if (!projectPath || typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
      continue
    }
    result[projectPath] = value
  }
  return result
}

function sanitizeBooleanByProject(raw: unknown) {
  if (!isObjectRecord(raw)) return {}
  const result: Record<string, boolean> = {}
  for (const [rawProjectPath, value] of Object.entries(raw)) {
    const projectPath = rawProjectPath.trim()
    if (projectPath && typeof value === 'boolean') result[projectPath] = value
  }
  return result
}

function storedValue(storedSettings: Readonly<Record<string, unknown>>, key: string) {
  return Object.hasOwn(storedSettings, key) ? storedSettings[key] : undefined
}

export function resolveStoredSessionHostSettings(
  storedSettings: Readonly<Record<string, unknown>>,
) {
  return {
    sessionHostParentConcurrencyLimit: resolveSessionHostParentConcurrencyLimit(
      storedValue(storedSettings, SETTINGS_KEY_SESSION_HOST_PARENT_CONCURRENCY_LIMIT),
    ),
    sessionHostParentConcurrencyLimitsByProject: sanitizePositiveIntegerByProject(
      storedValue(storedSettings, SETTINGS_KEY_SESSION_HOST_PARENT_CONCURRENCY_LIMITS_BY_PROJECT),
    ),
    sessionHostRunCeiling: resolveSessionHostRunCeiling(
      storedValue(storedSettings, SETTINGS_KEY_SESSION_HOST_RUN_CEILING),
    ),
    sessionHostIdleGracePeriodMs: resolveSessionHostIdleGracePeriodMs(
      storedValue(storedSettings, SETTINGS_KEY_SESSION_HOST_IDLE_GRACE_PERIOD_MS),
    ),
    multiAgentEnabled: resolveMultiAgentEnabled(
      storedValue(storedSettings, SETTINGS_KEY_MULTI_AGENT_ENABLED),
    ),
    multiAgentEnabledByProject: sanitizeBooleanByProject(
      storedValue(storedSettings, SETTINGS_KEY_MULTI_AGENT_ENABLED_BY_PROJECT),
    ),
  }
}

export function resolveNextSessionHostSettings(current: Settings, partial: Partial<Settings>) {
  const sessionHostParentConcurrencyLimit =
    partial.sessionHostParentConcurrencyLimit !== undefined
      ? resolveSessionHostParentConcurrencyLimit(partial.sessionHostParentConcurrencyLimit)
      : current.sessionHostParentConcurrencyLimit
  const sessionHostParentConcurrencyLimitsByProject =
    partial.sessionHostParentConcurrencyLimitsByProject !== undefined
      ? sanitizePositiveIntegerByProject(partial.sessionHostParentConcurrencyLimitsByProject)
      : current.sessionHostParentConcurrencyLimitsByProject
  const sessionHostRunCeiling =
    partial.sessionHostRunCeiling !== undefined
      ? resolveSessionHostRunCeiling(partial.sessionHostRunCeiling)
      : current.sessionHostRunCeiling
  const sessionHostIdleGracePeriodMs =
    partial.sessionHostIdleGracePeriodMs !== undefined
      ? resolveSessionHostIdleGracePeriodMs(partial.sessionHostIdleGracePeriodMs)
      : current.sessionHostIdleGracePeriodMs
  const multiAgentEnabled =
    partial.multiAgentEnabled !== undefined
      ? resolveMultiAgentEnabled(partial.multiAgentEnabled)
      : current.multiAgentEnabled
  const multiAgentEnabledByProject =
    partial.multiAgentEnabledByProject !== undefined
      ? sanitizeBooleanByProject(partial.multiAgentEnabledByProject)
      : current.multiAgentEnabledByProject

  return {
    sessionHostParentConcurrencyLimit,
    sessionHostParentConcurrencyLimitsByProject,
    sessionHostRunCeiling,
    sessionHostIdleGracePeriodMs,
    multiAgentEnabled,
    multiAgentEnabledByProject,
  }
}
