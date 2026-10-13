/**
 * Provider ids Pi renamed without migrating stored references. Pi 1.0.3 renamed
 * `azure-openai-responses` to `azure` and asks users to edit `auth.json`, `models.json`, and
 * `settings.json` by hand; OpenWaggle carries every reference it owns across instead.
 */
export const LEGACY_PROVIDER_RENAMES: ReadonlyMap<string, string> = new Map([
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
