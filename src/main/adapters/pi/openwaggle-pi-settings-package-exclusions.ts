import { decodeUnknownOrThrow } from '@shared/schema'
import { jsonObjectSchema } from '@shared/schemas/validation'
import type { JsonObject, JsonValue } from '@shared/types/json'
import { isStringArray } from './openwaggle-pi-settings-resources'

const JSON_INDENT_SPACES = 2

function parseJsonObject(content: string | undefined): JsonObject {
  if (!content || content.trim().length === 0) return {}
  const parsed: unknown = JSON.parse(content)
  return decodeUnknownOrThrow(jsonObjectSchema, parsed)
}

function serializeJsonObject(value: JsonObject) {
  return `${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`
}

function getPackageSource(value: JsonValue): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return typeof value.source === 'string' ? value.source : null
  }
  return null
}

function getPackageEntries(settings: JsonObject) {
  return Array.isArray(settings.packages) ? [...settings.packages] : []
}

function getExcludedExtensionPatterns(excludedSources: readonly string[]) {
  return excludedSources.flatMap((source) => [`!${source}`, `!${source}/**`])
}

function withExcludedExtensionPatterns(settings: JsonObject, excludedSources: readonly string[]) {
  const nextExtensions = isStringArray(settings.extensions) ? [...settings.extensions] : []
  const extensionSet = new Set(nextExtensions)
  for (const pattern of getExcludedExtensionPatterns(excludedSources)) {
    if (extensionSet.has(pattern)) continue
    nextExtensions.push(pattern)
    extensionSet.add(pattern)
  }
  return nextExtensions.length === 0 ? settings : { ...settings, extensions: nextExtensions }
}

function isExcludedPackageSource(value: JsonValue, excludedSources: ReadonlySet<string>) {
  const source = getPackageSource(value)
  return source !== null && excludedSources.has(source)
}

export function withoutExcludedPackages(
  content: string | undefined,
  excludedSources: readonly string[] | undefined,
) {
  if (!excludedSources || excludedSources.length === 0) return content
  const settings = parseJsonObject(content)
  const packages = getPackageEntries(settings)
  const excluded = new Set(excludedSources)
  const visiblePackages = packages.filter((entry) => !isExcludedPackageSource(entry, excluded))
  const visibleSettings =
    visiblePackages.length === packages.length
      ? settings
      : { ...settings, packages: visiblePackages }
  return serializeJsonObject(withExcludedExtensionPatterns(visibleSettings, excludedSources))
}

export function withoutExcludedPackageEntries(
  content: string | undefined,
  excludedSources: readonly string[] | undefined,
) {
  if (!content || !excludedSources || excludedSources.length === 0) return content
  const settings = parseJsonObject(content)
  const excluded = new Set(excludedSources)
  const packages = getPackageEntries(settings)
  const retained = packages.filter((entry) => !isExcludedPackageSource(entry, excluded))
  if (retained.length === packages.length) return content
  const { packages: ignoredPackages, ...withoutPackages } = settings
  void ignoredPackages
  return serializeJsonObject({
    ...withoutPackages,
    ...(retained.length > 0 ? { packages: retained } : {}),
  })
}

export function withoutSyntheticExcludedExtensionPatterns(
  currentContent: string | undefined,
  nextContent: string | undefined,
  excludedSources: readonly string[] | undefined,
) {
  if (!nextContent || !excludedSources || excludedSources.length === 0) return nextContent
  const currentSettings = parseJsonObject(currentContent)
  const nextSettings = parseJsonObject(nextContent)
  const currentExtensions = new Set(
    isStringArray(currentSettings.extensions) ? currentSettings.extensions : [],
  )
  const syntheticPatterns = new Set(getExcludedExtensionPatterns(excludedSources))
  const nextExtensions = isStringArray(nextSettings.extensions) ? nextSettings.extensions : []
  const persisted = nextExtensions.filter(
    (entry) => !syntheticPatterns.has(entry) || currentExtensions.has(entry),
  )
  if (persisted.length === nextExtensions.length) return nextContent
  const { extensions: ignoredExtensions, ...settingsWithoutExtensions } = nextSettings
  void ignoredExtensions
  return serializeJsonObject({
    ...settingsWithoutExtensions,
    ...(persisted.length > 0 ? { extensions: persisted } : {}),
  })
}
