import type { JsonObject, JsonValue } from '@shared/types/json'

/**
 * Provider ids Pi renamed without migrating stored references. Pi 1.0.3 renamed
 * `azure-openai-responses` to `azure` and asks users to edit `auth.json`, `models.json`, and
 * `settings.json` by hand; OpenWaggle carries every reference it owns across instead.
 */
const LEGACY_PROVIDER_RENAMES: ReadonlyMap<string, string> = new Map([
  ['azure-openai-responses', 'azure'],
])

const MODEL_REFERENCE_SEPARATOR = '/'

export function renameLegacyProviderId(providerId: string): string {
  return LEGACY_PROVIDER_RENAMES.get(providerId) ?? providerId
}

/** Renames the provider of a `provider/modelId` reference or `provider/*` pattern. */
export function renameLegacyProviderModelReference(reference: string): string {
  const separatorIndex = reference.indexOf(MODEL_REFERENCE_SEPARATOR)
  if (separatorIndex <= 0) return reference
  const providerId = reference.slice(0, separatorIndex)
  const renamed = LEGACY_PROVIDER_RENAMES.get(providerId)
  return renamed ? `${renamed}${reference.slice(separatorIndex)}` : reference
}

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

/**
 * Pi settings with renamed providers in `defaultProvider`, `enabledModels` patterns, and
 * `modelThinkingLevels` keys. Returns the same object when nothing needs renaming.
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
