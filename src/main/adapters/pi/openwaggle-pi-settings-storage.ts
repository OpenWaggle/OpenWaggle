import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent'
import { decodeUnknownOrThrow, type SchemaType } from '@shared/schema'
import { jsonObjectSchema, projectSettingsFileSchema } from '@shared/schemas/validation'
import type { JsonObject, JsonValue } from '@shared/types/json'
import {
  withoutExcludedPackageEntries,
  withoutExcludedPackages,
  withoutSyntheticExcludedExtensionPatterns,
  withRestoredExcludedNpmPackageEntries,
} from './openwaggle-pi-settings-package-exclusions'
import { withoutImplicitOpenWaggleResourcePrecedence } from './openwaggle-pi-settings-resource-removal'
import {
  type OpenWaggleResourcePrecedenceOptions,
  PI_CONFIG_DIR,
  withOpenWaggleResourcePrecedence,
} from './openwaggle-pi-settings-resources'

const JSON_INDENT_SPACES = 2
const OPENWAGGLE_CONFIG_DIR = '.openwaggle'
const SETTINGS_FILE_NAME = 'settings.json'
type ParsedProjectSettingsFile = SchemaType<typeof projectSettingsFileSchema>

type SettingsScope = 'global' | 'project'

interface SettingsStorageLike {
  withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void
}

interface OpenWagglePiSettingsManagerOptions extends OpenWaggleResourcePrecedenceOptions {
  readonly compactionThresholdPercent?: number
  readonly excludedGlobalPackageSources?: readonly string[]
  readonly excludedProjectPackageSources?: readonly string[]
  readonly runtimeExcludedNpmPackageNames?: readonly string[]
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

function removeExcludedPackagesFromPiSettingsFile(
  filePath: string,
  excludedSources: readonly string[] | undefined,
) {
  const current = readFileIfPresent(filePath)
  const next = withoutExcludedPackageEntries(current, excludedSources)
  if (current !== undefined && next !== undefined && next !== current) writeJsonFile(filePath, next)
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

function withOpenWaggleCompactionThreshold(
  settings: JsonObject,
  thresholdPercent: number | undefined,
): JsonObject {
  if (thresholdPercent === undefined) return settings
  const compaction = isJsonObject(settings.compaction) ? settings.compaction : {}
  return {
    ...settings,
    compaction: {
      ...compaction,
      thresholdPercent,
    },
  }
}

function withoutOpenWaggleCompactionThreshold(settings: JsonObject): JsonObject {
  if (!isJsonObject(settings.compaction)) return settings
  const { compaction: _currentCompaction, ...otherSettings } = settings
  const { thresholdPercent: _thresholdPercent, ...compaction } = settings.compaction
  return {
    ...otherSettings,
    ...(Object.keys(compaction).length > 0 ? { compaction } : {}),
  }
}

function removeExcludedPackagesFromOpenWaggleProjectSettings(
  projectPath: string,
  excludedSources: readonly string[] | undefined,
) {
  const settingsPath = getOpenWaggleProjectSettingsPath(projectPath)
  const raw = readFileIfPresent(settingsPath)
  if (raw === undefined) return
  const current = parseOpenWaggleSettings(raw)
  if (!isJsonObject(current.pi)) return
  const currentPi = serializeJsonObject(current.pi)
  const nextPi = withoutExcludedPackageEntries(currentPi, excludedSources)
  if (!nextPi || nextPi === currentPi) return
  const next = decodeUnknownOrThrow(projectSettingsFileSchema, {
    ...current,
    pi: parseJsonObject(nextPi),
  })
  writeJsonFile(settingsPath, serializeOpenWaggleSettings(next))
}

function readProjectPiSettings(projectPath: string, options: OpenWagglePiSettingsManagerOptions) {
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
  return withOpenWaggleCompactionThreshold(
    withOpenWaggleResourcePrecedence(projectPath, mergedSettings, options),
    options.compactionThresholdPercent,
  )
}

function writeProjectPiSettings(
  projectPath: string,
  nextPiSettings: string,
  options: OpenWagglePiSettingsManagerOptions,
) {
  const nextPi = withoutOpenWaggleCompactionThreshold(
    withoutImplicitOpenWaggleResourcePrecedence(
      projectPath,
      parseJsonObject(nextPiSettings),
      options,
    ),
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
  removeExcludedPackagesFromPiSettingsFile(
    getPiProjectSettingsPath(projectPath),
    options.excludedProjectPackageSources,
  )
  removeExcludedPackagesFromOpenWaggleProjectSettings(
    projectPath,
    options.excludedProjectPackageSources,
  )
  return {
    withLock(scope, fn) {
      if (scope === 'global') {
        withGlobalPiSettingsLock(options, fn)
        return
      }

      const current = serializeJsonObject(readProjectPiSettings(projectPath, options))
      const visibleCurrent = withoutExcludedPackages(
        current,
        options.excludedProjectPackageSources,
        options.runtimeExcludedNpmPackageNames,
      )
      const nextWithoutSyntheticPatterns = withoutSyntheticExcludedExtensionPatterns(
        current,
        fn(visibleCurrent),
        options.excludedProjectPackageSources,
      )
      const nextWithRestoredRuntimePackages = withRestoredExcludedNpmPackageEntries(
        current,
        nextWithoutSyntheticPatterns,
        options.runtimeExcludedNpmPackageNames,
      )
      const next = withoutExcludedPackageEntries(
        nextWithRestoredRuntimePackages,
        options.excludedProjectPackageSources,
      )
      if (next !== undefined) {
        writeProjectPiSettings(projectPath, next, options)
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
  const visibleCurrent = withoutExcludedPackages(
    current,
    options.excludedGlobalPackageSources,
    options.runtimeExcludedNpmPackageNames,
  )
  const nextWithoutSyntheticPatterns = withoutSyntheticExcludedExtensionPatterns(
    current,
    fn(visibleCurrent),
    options.excludedGlobalPackageSources,
  )
  const nextWithRestoredRuntimePackages = withRestoredExcludedNpmPackageEntries(
    current,
    nextWithoutSyntheticPatterns,
    options.runtimeExcludedNpmPackageNames,
  )
  const next = withoutExcludedPackageEntries(
    nextWithRestoredRuntimePackages,
    options.excludedGlobalPackageSources,
  )
  if (next !== undefined) {
    writeJsonFile(globalSettingsPath, next)
  }
}

function createOpenWaggleGlobalPiSettingsStorage(
  options: OpenWagglePiSettingsManagerOptions = {},
): SettingsStorageLike {
  removeExcludedPackagesFromPiSettingsFile(
    getPiGlobalSettingsPath(),
    options.excludedGlobalPackageSources,
  )
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
