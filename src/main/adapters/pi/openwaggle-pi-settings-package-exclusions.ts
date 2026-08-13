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

function getNpmPackageName(source: string) {
  if (!source.startsWith('npm:')) return null
  const spec = source.slice('npm:'.length).trim()
  if (spec.length === 0) return null
  if (!spec.startsWith('@')) {
    const versionSeparator = spec.indexOf('@')
    return versionSeparator > 0 ? spec.slice(0, versionSeparator) : spec
  }

  const scopeSeparator = spec.indexOf('/')
  if (scopeSeparator < 0) return spec
  const versionSeparator = spec.indexOf('@', scopeSeparator)
  return versionSeparator > scopeSeparator ? spec.slice(0, versionSeparator) : spec
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

function isExcludedNpmPackage(value: JsonValue, excludedNames: ReadonlySet<string>) {
  const source = getPackageSource(value)
  if (source === null) return false
  const packageName = getNpmPackageName(source)
  return packageName !== null && excludedNames.has(packageName)
}

export function withoutExcludedPackages(
  content: string | undefined,
  excludedSources: readonly string[] | undefined,
  excludedNpmPackageNames: readonly string[] | undefined = undefined,
) {
  if (
    (!excludedSources || excludedSources.length === 0) &&
    (!excludedNpmPackageNames || excludedNpmPackageNames.length === 0)
  ) {
    return content
  }
  const settings = parseJsonObject(content)
  const packages = getPackageEntries(settings)
  const excludedSourceSet = new Set(excludedSources ?? [])
  const excludedNpmPackageNameSet = new Set(excludedNpmPackageNames ?? [])
  const visiblePackages = packages.filter(
    (entry) =>
      !isExcludedPackageSource(entry, excludedSourceSet) &&
      !isExcludedNpmPackage(entry, excludedNpmPackageNameSet),
  )
  const visibleSettings =
    visiblePackages.length === packages.length
      ? settings
      : { ...settings, packages: visiblePackages }
  return serializeJsonObject(withExcludedExtensionPatterns(visibleSettings, excludedSources ?? []))
}

export function withRestoredExcludedNpmPackageEntries(
  currentContent: string | undefined,
  nextContent: string | undefined,
  excludedNpmPackageNames: readonly string[] | undefined,
) {
  if (!nextContent || !excludedNpmPackageNames || excludedNpmPackageNames.length === 0) {
    return nextContent
  }

  const excludedNames = new Set(excludedNpmPackageNames)
  const currentSettings = parseJsonObject(currentContent)
  const excludedEntries = getPackageEntries(currentSettings).flatMap((entry, index) =>
    isExcludedNpmPackage(entry, excludedNames) ? [{ entry, index }] : [],
  )
  if (excludedEntries.length === 0) return nextContent

  const nextSettings = parseJsonObject(nextContent)
  const restoredPackages = getPackageEntries(nextSettings).filter(
    (entry) => !isExcludedNpmPackage(entry, excludedNames),
  )
  for (const excludedEntry of excludedEntries) {
    restoredPackages.splice(
      Math.min(excludedEntry.index, restoredPackages.length),
      0,
      excludedEntry.entry,
    )
  }

  return serializeJsonObject({ ...nextSettings, packages: restoredPackages })
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
