import {
  type ProviderRestrictionScope,
  PROVIDER_RESTRICTION_ONLY_KEY,
  type ProviderRestrictionsByPath,
} from '@shared/utils/provider-restriction'
import { isObjectRecord } from './sanitizers'
import {
  SETTINGS_KEY_PROVIDER_RESTRICTIONS,
  SETTINGS_KEY_PROVIDER_RESTRICTIONS_BY_PATH,
} from './keys'
import type { Settings } from '@shared/types/settings'

import type { SettingsPatchWrite } from './persistence-plan'

/**
 * One scope entry as stored: a provider's boolean choice, or the reserved `only` id list. An
 * `only` value that is not a list of provider ids fails closed as empty, which the resolver reads
 * as permitting no provider, rather than dropping the key and silently reopening the scope.
 */
function sanitizeScopeEntry(key: string, value: unknown) {
  if (key === PROVIDER_RESTRICTION_ONLY_KEY) return sanitizeOnlyList(value)
  return typeof value === 'boolean' ? value : null
}

function sanitizeOnlyList(value: unknown) {
  if (!Array.isArray(value)) return []
  const ids: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0) return []
    ids.push(entry.trim())
  }
  return ids
}

/** A stored scope's valid entries; anything else, such as a hand edit, is dropped. */
export function sanitizeProviderRestrictionScope(raw: unknown) {
  const scope: Record<string, boolean | readonly string[]> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return scope
  for (const [rawKey, value] of Object.entries(raw)) {
    const key = rawKey.trim()
    if (!key) continue
    const entry = sanitizeScopeEntry(key, value)
    if (entry !== null) scope[key] = entry
  }
  return scope
}

/**
 * The stored app-wide and path scopes. A path scope keeps its folder even with no valid entry,
 * because Settings adds a folder before any provider is chosen for it; an empty scope only falls
 * through to the next one.
 */
export function sanitizeProviderRestrictions(raw: unknown) {
  return sanitizeProviderRestrictionScope(raw)
}

export function sanitizeProviderRestrictionsByPath(raw: unknown) {
  const result: Record<string, Record<string, boolean | readonly string[]>> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return result
  for (const [rawPath, scope] of Object.entries(raw)) {
    const path = rawPath.trim()
    if (!path || typeof scope !== 'object' || scope === null || Array.isArray(scope)) continue
    result[path] = sanitizeProviderRestrictionScope(scope)
  }
  return result
}

/**
 * The stored restriction scopes as the snapshot carries them. A row that is absent or unreadable
 * is an empty scope, which allows every provider: the sanitizers already read unknown that way.
 */
export function resolveStoredProviderRestrictionSettings(storedSettings: unknown) {
  const stored = isObjectRecord(storedSettings) ? storedSettings : {}
  return {
    providerRestrictions: sanitizeProviderRestrictions(stored[SETTINGS_KEY_PROVIDER_RESTRICTIONS]),
    providerRestrictionsByPath: sanitizeProviderRestrictionsByPath(
      stored[SETTINGS_KEY_PROVIDER_RESTRICTIONS_BY_PATH],
    ),
  } satisfies {
    readonly providerRestrictions: ProviderRestrictionScope
    readonly providerRestrictionsByPath: ProviderRestrictionsByPath
  }
}

export function resolveNextProviderRestrictionSettings(
  current: Settings,
  partial: Partial<Settings>,
) {
  return {
    providerRestrictions:
      partial.providerRestrictions === undefined
        ? current.providerRestrictions
        : sanitizeProviderRestrictions(partial.providerRestrictions),
    providerRestrictionsByPath:
      partial.providerRestrictionsByPath === undefined
        ? current.providerRestrictionsByPath
        : sanitizeProviderRestrictionsByPath(partial.providerRestrictionsByPath),
  }
}

export function appendProviderRestrictionSettingsWrites(
  writes: SettingsPatchWrite[],
  partial: Partial<Settings>,
  next: Settings,
) {
  if (partial.providerRestrictions !== undefined) {
    writes.push({ key: SETTINGS_KEY_PROVIDER_RESTRICTIONS, value: next.providerRestrictions })
  }
  if (partial.providerRestrictionsByPath !== undefined) {
    writes.push({
      key: SETTINGS_KEY_PROVIDER_RESTRICTIONS_BY_PATH,
      value: next.providerRestrictionsByPath,
    })
  }
}
