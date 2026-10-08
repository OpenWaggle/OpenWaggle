import type { JsonObject, JsonValue } from '@shared/types/json'
import {
  LEGACY_PROVIDER_RENAMES,
  renameLegacyProviderId,
  renameLegacyProviderModelReference,
} from '../../domain/legacy-provider-renames'

function renamedStringArray(value: JsonValue | undefined): JsonValue[] | undefined {
  if (!Array.isArray(value)) return undefined
  let changed = false
  const next = value.map((entry) => {
    if (typeof entry !== 'string') return entry
    const renamed = renameLegacyProviderModelReference(entry)
    changed ||= renamed !== entry
    return renamed
  })
  return changed ? next : undefined
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function renamedModelKeyedObject(value: JsonValue | undefined): JsonObject | undefined {
  if (!isJsonObject(value)) return undefined
  const keys = Object.keys(value)
  if (!keys.some((key) => renameLegacyProviderModelReference(key) !== key)) return undefined
  const next: Record<string, JsonValue> = {}
  for (const key of keys) {
    const renamed = renameLegacyProviderModelReference(key)
    // A value already stored under the new name was set after the rename and wins.
    if (renamed !== key && Object.hasOwn(value, renamed)) continue
    const entry = value[key]
    if (entry !== undefined) next[renamed] = entry
  }
  return next
}

function renamedCompaction(value: JsonValue | undefined): JsonObject | undefined {
  if (!isJsonObject(value)) return undefined
  const modelOverrides = renamedModelKeyedObject(value.modelOverrides)
  return modelOverrides ? { ...value, modelOverrides } : undefined
}

/**
 * Pi settings with renamed providers in `defaultProvider`, `enabledModels` patterns, and the
 * `provider/modelId` keys of `modelThinkingLevels` and `compaction.modelOverrides`. Returns the
 * same object when nothing needs renaming.
 */
export function renameLegacyProviderPiSettings<T extends JsonObject>(settings: T): T {
  const next: Record<string, JsonValue> = { ...settings }
  let changed = false
  const defaultProvider = settings.defaultProvider
  if (
    typeof defaultProvider === 'string' &&
    renameLegacyProviderId(defaultProvider) !== defaultProvider
  ) {
    next.defaultProvider = renameLegacyProviderId(defaultProvider)
    changed = true
  }
  const enabledModels = renamedStringArray(settings.enabledModels)
  if (enabledModels) {
    next.enabledModels = enabledModels
    changed = true
  }
  const modelThinkingLevels = renamedModelKeyedObject(settings.modelThinkingLevels)
  if (modelThinkingLevels) {
    next.modelThinkingLevels = modelThinkingLevels
    changed = true
  }
  const compaction = renamedCompaction(settings.compaction)
  if (compaction) {
    next.compaction = compaction
    changed = true
  }
  return changed ? { ...settings, ...next } : settings
}

/**
 * Stored credentials with each renamed provider's credential copied to its new key. The old key
 * stays, because a standalone Pi older than the rename can share the same `auth.json`; a
 * credential already stored under the new key is never replaced.
 */
export function renameLegacyProviderCredentials<T extends JsonObject>(credentials: T): T {
  const next: Record<string, JsonValue> = { ...credentials }
  let changed = false
  for (const [legacyId, providerId] of LEGACY_PROVIDER_RENAMES) {
    const credential = credentials[legacyId]
    if (credential === undefined || Object.hasOwn(credentials, providerId)) continue
    next[providerId] = credential
    changed = true
  }
  return changed ? { ...credentials, ...next } : credentials
}
