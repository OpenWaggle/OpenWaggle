import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getAgentDir, SettingsManager } from '@mariozechner/pi-coding-agent'
import { decodeUnknownOrThrow, type SchemaType } from '@shared/schema'
import { jsonObjectSchema, projectSettingsFileSchema } from '@shared/schemas/validation'
import type { JsonObject, JsonValue } from '@shared/types/json'
import {
  isStringArray,
  PI_CONFIG_DIR,
  withOpenWaggleResourcePrecedence,
  withoutImplicitOpenWaggleResourcePrecedence,
} from './openwaggle-pi-settings-resources'

const JSON_INDENT_SPACES = 2
const OPENWAGGLE_CONFIG_DIR = '.openwaggle'
const SETTINGS_FILE_NAME = 'settings.json'
type ParsedProjectSettingsFile = SchemaType<typeof projectSettingsFileSchema>

type SettingsScope = 'global' | 'project'

interface SettingsStorageLike {
  withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void
}

interface OpenWagglePiSettingsManagerOptions {
  readonly excludedGlobalPackageSources?: readonly string[]
  readonly excludedProjectPackageSources?: readonly string[]
}

function getOpenWaggleProjectSettingsPath(projectPath: string) {
  return join(projectPath, OPENWAGGLE_CONFIG_DIR, SETTINGS_FILE_NAME)
}

function getPiProjectSettingsPath(projectPath: string) {
  return join(projectPath, PI_CONFIG_DIR, SETTINGS_FILE_NAME)
}

function getPiGlobalSettingsPath() {
  return join(getAgentDir(), SETTINGS_FILE_NAME)
}

function readFileIfPresent(filePath: string): string | undefined {
  return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : undefined
}

function writeJsonFile(filePath: string, content: string) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf-8')
}

function parseJsonObject(content: string | undefined): JsonObject {
  if (!content || content.trim().length === 0) {
    return {}
  }
  const parsed: unknown = JSON.parse(content)
  return decodeUnknownOrThrow(jsonObjectSchema, parsed)
}

function parseOpenWaggleSettings(content: string | undefined): ParsedProjectSettingsFile {
  if (!content || content.trim().length === 0) {
    return {}
  }
  const parsed: unknown = JSON.parse(content)
  return decodeUnknownOrThrow(projectSettingsFileSchema, parsed)
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getPackageSource(value: JsonValue): string | null {
  if (typeof value === 'string') {
    return value
  }
  if (isJsonObject(value) && typeof value.source === 'string') {
    return value.source
  }
  return null
}

function getPackageEntries(settings: JsonObject) {
  return Array.isArray(settings.packages) ? [...settings.packages] : []
}

function getExcludedExtensionPatterns(excludedPackageSources: readonly string[]) {
  return excludedPackageSources.flatMap((source) => [`!${source}`, `!${source}/**`])
}

function withExcludedExtensionPatterns(
  settings: JsonObject,
  excludedPackageSources: readonly string[],
) {
  const excludedPatterns = getExcludedExtensionPatterns(excludedPackageSources)
  if (excludedPatterns.length === 0) {
    return settings
  }

  const extensions = isStringArray(settings.extensions) ? settings.extensions : []
  const nextExtensions = [...extensions]
  for (const pattern of excludedPatterns) {
    if (!nextExtensions.includes(pattern)) {
      nextExtensions.push(pattern)
    }
  }
  return {
    ...settings,
    extensions: nextExtensions,
  }
}

function isExcludedPackageSource(value: JsonValue, excludedPackageSources: ReadonlySet<string>) {
  const source = getPackageSource(value)
  return source !== null && excludedPackageSources.has(source)
}

function withoutExcludedPackages(
  content: string | undefined,
  excludedPackageSources: readonly string[] | undefined,
) {
  if (!excludedPackageSources || excludedPackageSources.length === 0) {
    return content
  }

  const settings = parseJsonObject(content)
  const packages = getPackageEntries(settings)
  if (packages.length === 0) {
    return serializeJsonObject(withExcludedExtensionPatterns(settings, excludedPackageSources))
  }

  const excludedSources = new Set(excludedPackageSources)
  const visiblePackages = packages.filter(
    (entry) => !isExcludedPackageSource(entry, excludedSources),
  )
  const visibleSettings =
    visiblePackages.length === packages.length
      ? settings
      : {
          ...settings,
          packages: visiblePackages,
        }

  return serializeJsonObject(withExcludedExtensionPatterns(visibleSettings, excludedPackageSources))
}

function withPreservedExcludedPackages(
  currentContent: string | undefined,
  nextContent: string | undefined,
  excludedPackageSources: readonly string[] | undefined,
) {
  if (!nextContent || !excludedPackageSources || excludedPackageSources.length === 0) {
    return nextContent
  }

  const currentSettings = parseJsonObject(currentContent)
  const nextSettings = parseJsonObject(nextContent)
  const excludedSources = new Set(excludedPackageSources)
  const excludedPackages = getPackageEntries(currentSettings).filter((entry) =>
    isExcludedPackageSource(entry, excludedSources),
  )
  if (excludedPackages.length === 0) {
    return nextContent
  }

  const nextPackages = getPackageEntries(nextSettings)
  const nextPackageSources = new Set(
    nextPackages.map(getPackageSource).filter((source) => source !== null),
  )
  const preservedPackages = excludedPackages.filter((entry) => {
    const source = getPackageSource(entry)
    return source !== null && !nextPackageSources.has(source)
  })
  if (preservedPackages.length === 0) {
    return nextContent
  }

  return serializeJsonObject({
    ...nextSettings,
    packages: [...nextPackages, ...preservedPackages],
  })
}

function mergeJsonObjects(base: JsonObject, override: JsonObject) {
  const result: JsonObject = { ...base }
  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = result[key]
    result[key] =
      isJsonObject(baseValue) && isJsonObject(overrideValue)
        ? mergeJsonObjects(baseValue, overrideValue)
        : overrideValue
  }
  return result
}

function serializeJsonObject(value: JsonObject) {
  return `${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`
}

function serializeOpenWaggleSettings(value: ParsedProjectSettingsFile) {
  return `${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`
}

function readProjectPiSettings(projectPath: string) {
  const piProjectSettings = parseJsonObject(
    readFileIfPresent(getPiProjectSettingsPath(projectPath)),
  )
  const openWaggleSettings = parseOpenWaggleSettings(
    readFileIfPresent(getOpenWaggleProjectSettingsPath(projectPath)),
  )
  const openWagglePiSettings = openWaggleSettings.pi
  const mergedSettings = isJsonObject(openWagglePiSettings)
    ? mergeJsonObjects(piProjectSettings, openWagglePiSettings)
    : piProjectSettings
  return withOpenWaggleResourcePrecedence(projectPath, mergedSettings)
}

function writeProjectPiSettings(projectPath: string, nextPiSettings: string) {
  const nextPi = withoutImplicitOpenWaggleResourcePrecedence(
    projectPath,
    parseJsonObject(nextPiSettings),
  )
  const settingsPath = getOpenWaggleProjectSettingsPath(projectPath)
  const currentOpenWaggleSettings = parseOpenWaggleSettings(readFileIfPresent(settingsPath))
  const nextOpenWaggleSettings = decodeUnknownOrThrow(projectSettingsFileSchema, {
    ...currentOpenWaggleSettings,
    pi: nextPi,
  })
  writeJsonFile(settingsPath, serializeOpenWaggleSettings(nextOpenWaggleSettings))
}

function createOpenWagglePiSettingsStorage(
  projectPath: string,
  options: OpenWagglePiSettingsManagerOptions = {},
): SettingsStorageLike {
  return {
    withLock(scope, fn) {
      if (scope === 'global') {
        withGlobalPiSettingsLock(options, fn)
        return
      }

      const current = serializeJsonObject(readProjectPiSettings(projectPath))
      const visibleCurrent = withoutExcludedPackages(current, options.excludedProjectPackageSources)
      const next = withPreservedExcludedPackages(
        current,
        fn(visibleCurrent),
        options.excludedProjectPackageSources,
      )
      if (next !== undefined) {
        writeProjectPiSettings(projectPath, next)
      }
    },
  }
}

function withGlobalPiSettingsLock(
  options: OpenWagglePiSettingsManagerOptions,
  fn: (current: string | undefined) => string | undefined,
) {
  const globalSettingsPath = getPiGlobalSettingsPath()
  const current = readFileIfPresent(globalSettingsPath)
  const visibleCurrent = withoutExcludedPackages(current, options.excludedGlobalPackageSources)
  const next = withPreservedExcludedPackages(
    current,
    fn(visibleCurrent),
    options.excludedGlobalPackageSources,
  )
  if (next !== undefined) {
    writeJsonFile(globalSettingsPath, next)
  }
}

function createOpenWaggleGlobalPiSettingsStorage(
  options: OpenWagglePiSettingsManagerOptions = {},
): SettingsStorageLike {
  return {
    withLock(scope, fn) {
      if (scope === 'global') {
        withGlobalPiSettingsLock(options, fn)
        return
      }
      fn(undefined)
    },
  }
}

export function createOpenWagglePiSettingsManager(
  projectPath: string,
  options: OpenWagglePiSettingsManagerOptions = {},
): SettingsManager {
  return SettingsManager.fromStorage(createOpenWagglePiSettingsStorage(projectPath, options))
}

export function createOpenWaggleGlobalPiSettingsManager(
  options: OpenWagglePiSettingsManagerOptions = {},
): SettingsManager {
  return SettingsManager.fromStorage(createOpenWaggleGlobalPiSettingsStorage(options))
}
