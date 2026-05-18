import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getAgentDir, SettingsManager } from '@mariozechner/pi-coding-agent'
import { decodeUnknownOrThrow, type SchemaType } from '@shared/schema'
import { jsonObjectSchema, projectSettingsFileSchema } from '@shared/schemas/validation'
import type { JsonObject, JsonValue } from '@shared/types/json'

const JSON_INDENT_SPACES = 2
const OPENWAGGLE_CONFIG_DIR = '.openwaggle'
const PI_CONFIG_DIR = '.pi'
const SETTINGS_FILE_NAME = 'settings.json'
type ResourceKind = 'skills' | 'extensions' | 'prompts' | 'themes'
type ParsedProjectSettingsFile = SchemaType<typeof projectSettingsFileSchema>

type ResourceRootSegments = Readonly<Record<ResourceKind, readonly string[]>>

const OPENWAGGLE_RESOURCE_ROOTS: ResourceRootSegments = {
  skills: ['..', OPENWAGGLE_CONFIG_DIR, 'skills'],
  extensions: ['..', OPENWAGGLE_CONFIG_DIR, 'extensions'],
  prompts: ['..', OPENWAGGLE_CONFIG_DIR, 'prompts'],
  themes: ['..', OPENWAGGLE_CONFIG_DIR, 'themes'],
}
const PI_RESOURCE_ROOTS: ResourceRootSegments = {
  skills: ['skills'],
  extensions: ['extensions'],
  prompts: ['prompts'],
  themes: ['themes'],
}
const AGENTS_RESOURCE_ROOTS: ResourceRootSegments = {
  skills: ['..', '.agents', 'skills'],
  extensions: ['..', '.agents', 'extensions'],
  prompts: ['..', '.agents', 'prompts'],
  themes: ['..', '.agents', 'themes'],
}

type SettingsScope = 'global' | 'project'

interface SettingsStorageLike {
  withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void
}

interface OpenWagglePiSettingsManagerOptions {
  readonly excludedGlobalPackageSources?: readonly string[]
  readonly excludedProjectPackageSources?: readonly string[]
}

function getOpenWaggleProjectSettingsPath(projectPath: string): string {
  return join(projectPath, OPENWAGGLE_CONFIG_DIR, SETTINGS_FILE_NAME)
}

function getPiProjectSettingsPath(projectPath: string): string {
  return join(projectPath, PI_CONFIG_DIR, SETTINGS_FILE_NAME)
}

function getPiGlobalSettingsPath(): string {
  return join(getAgentDir(), SETTINGS_FILE_NAME)
}

function readFileIfPresent(filePath: string): string | undefined {
  return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : undefined
}

function writeJsonFile(filePath: string, content: string): void {
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

function getPackageEntries(settings: JsonObject): JsonValue[] {
  return Array.isArray(settings.packages) ? [...settings.packages] : []
}

function isExcludedPackageSource(
  value: JsonValue,
  excludedPackageSources: ReadonlySet<string>,
): boolean {
  const source = getPackageSource(value)
  return source !== null && excludedPackageSources.has(source)
}

function withoutExcludedPackages(
  content: string | undefined,
  excludedPackageSources: readonly string[] | undefined,
): string | undefined {
  if (!excludedPackageSources || excludedPackageSources.length === 0) {
    return content
  }

  const settings = parseJsonObject(content)
  const packages = getPackageEntries(settings)
  if (packages.length === 0) {
    return content
  }

  const excludedSources = new Set(excludedPackageSources)
  const visiblePackages = packages.filter(
    (entry) => !isExcludedPackageSource(entry, excludedSources),
  )
  if (visiblePackages.length === packages.length) {
    return content
  }

  return serializeJsonObject({
    ...settings,
    packages: visiblePackages,
  })
}

function withPreservedExcludedPackages(
  currentContent: string | undefined,
  nextContent: string | undefined,
  excludedPackageSources: readonly string[] | undefined,
): string | undefined {
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
    nextPackages.map(getPackageSource).filter((source): source is string => source !== null),
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

function mergeJsonObjects(base: JsonObject, override: JsonObject): JsonObject {
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

function serializeJsonObject(value: JsonObject): string {
  return `${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`
}

function serializeOpenWaggleSettings(value: ParsedProjectSettingsFile): string {
  return `${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`
}

function isStringArray(value: JsonValue | undefined): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function prependResourceRoots(
  projectPath: string,
  configured: JsonValue | undefined,
  roots: readonly (readonly string[])[],
): string[] {
  const result: string[] = []
  const seen = new Set<string>()

  function addPath(candidate: string): void {
    const resolved = join(projectPath, PI_CONFIG_DIR, candidate)
    if (seen.has(resolved)) {
      return
    }
    seen.add(resolved)
    result.push(candidate)
  }

  for (const root of roots) {
    addPath(join(...root))
  }
  if (isStringArray(configured)) {
    for (const configuredPath of configured) {
      addPath(configuredPath)
    }
  }

  return result
}

function getImplicitResourceRoots(kind: ResourceKind): readonly (readonly string[])[] {
  if (kind === 'skills') {
    return [
      OPENWAGGLE_RESOURCE_ROOTS.skills,
      PI_RESOURCE_ROOTS.skills,
      AGENTS_RESOURCE_ROOTS.skills,
    ]
  }
  if (kind === 'extensions') {
    return [
      OPENWAGGLE_RESOURCE_ROOTS.extensions,
      PI_RESOURCE_ROOTS.extensions,
      AGENTS_RESOURCE_ROOTS.extensions,
    ]
  }
  if (kind === 'prompts') {
    return [
      OPENWAGGLE_RESOURCE_ROOTS.prompts,
      PI_RESOURCE_ROOTS.prompts,
      AGENTS_RESOURCE_ROOTS.prompts,
    ]
  }
  return [OPENWAGGLE_RESOURCE_ROOTS.themes, PI_RESOURCE_ROOTS.themes, AGENTS_RESOURCE_ROOTS.themes]
}

function withOpenWaggleResourcePrecedence(projectPath: string, settings: JsonObject): JsonObject {
  return {
    ...settings,
    skills: prependResourceRoots(projectPath, settings.skills, getImplicitResourceRoots('skills')),
    extensions: prependResourceRoots(
      projectPath,
      settings.extensions,
      getImplicitResourceRoots('extensions'),
    ),
    prompts: prependResourceRoots(
      projectPath,
      settings.prompts,
      getImplicitResourceRoots('prompts'),
    ),
    themes: prependResourceRoots(projectPath, settings.themes, getImplicitResourceRoots('themes')),
  }
}

function removeImplicitResourceRoots(
  projectPath: string,
  configured: JsonValue | undefined,
  kind: ResourceKind,
): string[] | undefined {
  if (!isStringArray(configured)) {
    return undefined
  }

  const implicitRoots = new Set(
    getImplicitResourceRoots(kind).map((root) => join(projectPath, PI_CONFIG_DIR, join(...root))),
  )
  const filtered = configured.filter(
    (configuredPath) => !implicitRoots.has(join(projectPath, PI_CONFIG_DIR, configuredPath)),
  )
  return filtered.length > 0 ? filtered : undefined
}

function withoutImplicitOpenWaggleResourcePrecedence(
  projectPath: string,
  settings: JsonObject,
): JsonObject {
  const next: JsonObject = { ...settings }
  const skills = removeImplicitResourceRoots(projectPath, settings.skills, 'skills')
  const extensions = removeImplicitResourceRoots(projectPath, settings.extensions, 'extensions')
  const prompts = removeImplicitResourceRoots(projectPath, settings.prompts, 'prompts')
  const themes = removeImplicitResourceRoots(projectPath, settings.themes, 'themes')

  if (skills) {
    next.skills = skills
  } else {
    delete next.skills
  }
  if (extensions) {
    next.extensions = extensions
  } else {
    delete next.extensions
  }
  if (prompts) {
    next.prompts = prompts
  } else {
    delete next.prompts
  }
  if (themes) {
    next.themes = themes
  } else {
    delete next.themes
  }

  return next
}

function readProjectPiSettings(projectPath: string): JsonObject {
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

function writeProjectPiSettings(projectPath: string, nextPiSettings: string): void {
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
        const globalSettingsPath = getPiGlobalSettingsPath()
        const current = readFileIfPresent(globalSettingsPath)
        const visibleCurrent = withoutExcludedPackages(
          current,
          options.excludedGlobalPackageSources,
        )
        const next = withPreservedExcludedPackages(
          current,
          fn(visibleCurrent),
          options.excludedGlobalPackageSources,
        )
        if (next !== undefined) {
          writeJsonFile(globalSettingsPath, next)
        }
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

export function createOpenWagglePiSettingsManager(
  projectPath: string,
  options: OpenWagglePiSettingsManagerOptions = {},
): SettingsManager {
  return SettingsManager.fromStorage(createOpenWagglePiSettingsStorage(projectPath, options))
}
