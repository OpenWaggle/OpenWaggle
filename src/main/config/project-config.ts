import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeUnknownOrThrow, type SchemaType, safeDecodeUnknown } from '@shared/schema'
import { projectSettingsFileSchema } from '@shared/schemas/validation'
import { wagglePresetSchema } from '@shared/schemas/waggle'
import { SupportedModelId, WagglePresetId } from '@shared/types/brand'
import type { JsonObject } from '@shared/types/json'
import type { ThinkingLevel } from '@shared/types/settings'
import type { WagglePreset } from '@shared/types/waggle'
import { formatErrorMessage, isEnoent } from '@shared/utils/node-error'
import { createLogger } from '../logger'

const JSON_INDENT_SPACES = 2
const OPENWAGGLE_CONFIG_DIR = '.openwaggle'
const PROJECT_SETTINGS_FILE_NAME = 'settings.json'
const EMPTY_SETTINGS_JSON = '{}\n'

const logger = createLogger('project-config')

export interface ProjectPreferences {
  readonly model?: string
  readonly thinkingLevel?: ThinkingLevel
}

export interface ProjectConfig {
  readonly preferences?: ProjectPreferences
  readonly wagglePresets?: readonly WagglePreset[]
  readonly pi?: JsonObject
}

const EMPTY_CONFIG: ProjectConfig = {}
type ParsedProjectSettingsFile = SchemaType<typeof projectSettingsFileSchema>

interface ConfigCacheEntry {
  readonly config: ProjectConfig
  readonly settingsMtime: number | null
}

const configCache = new Map<string, ConfigCacheEntry>()

/** Clear cached configs — useful for tests and after known config edits. */
export function clearConfigCache(): void {
  configCache.clear()
}

function getConfigDirectoryPath(projectPath: string): string {
  return join(projectPath, OPENWAGGLE_CONFIG_DIR)
}

export function getProjectSettingsPath(projectPath: string): string {
  return join(getConfigDirectoryPath(projectPath), PROJECT_SETTINGS_FILE_NAME)
}

function getConfigTempPath(configPath: string): string {
  return `${configPath}.${randomUUID()}.tmp`
}

function parseSettingsJson(raw: string): unknown {
  return raw.trim().length > 0 ? JSON.parse(raw) : {}
}

async function readValidatedProjectSettings(
  filePath: string,
  options: {
    strict: boolean
    logLabel: string
  },
): Promise<ParsedProjectSettingsFile | null> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsedJson = parseSettingsJson(raw)
    const validated = safeDecodeUnknown(projectSettingsFileSchema, parsedJson)
    if (!validated.success) {
      const message = `Invalid project settings schema: ${validated.issues.join('; ')}`
      if (options.strict) {
        throw new Error(message)
      }
      logger.warn(`Failed to validate ${options.logLabel}`, { message })
      return null
    }
    return validated.data
  } catch (error) {
    if (isEnoent(error)) {
      return null
    }
    if (options.strict) {
      throw error
    }
    logger.warn(`Failed to parse ${options.logLabel}`, {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function readConfigMtime(filePath: string): Promise<number | null> {
  try {
    const metadata = await stat(filePath)
    return metadata.mtimeMs
  } catch (error) {
    if (isEnoent(error)) {
      return null
    }
    throw error
  }
}

export async function loadProjectConfig(projectPath: string): Promise<ProjectConfig> {
  const settingsPath = getProjectSettingsPath(projectPath)

  let settingsMtime: number | null

  try {
    settingsMtime = await readConfigMtime(settingsPath)
  } catch (error) {
    logger.warn('Failed to stat project settings file', {
      error: formatErrorMessage(error),
    })
    configCache.delete(projectPath)
    return EMPTY_CONFIG
  }

  const cached = configCache.get(projectPath)
  if (cached && cached.settingsMtime === settingsMtime) {
    return cached.config
  }

  const settings = await readValidatedProjectSettings(settingsPath, {
    strict: false,
    logLabel: '.openwaggle/settings.json',
  })

  const mergedConfig = parseProjectConfig(settings)
  configCache.set(projectPath, {
    config: mergedConfig,
    settingsMtime,
  })

  return mergedConfig
}

async function ensureSettingsFile(projectPath: string, configPath: string): Promise<string> {
  const configDir = getConfigDirectoryPath(projectPath)

  await mkdir(configDir, { recursive: true })

  try {
    await stat(configPath)
  } catch (error) {
    if (!isEnoent(error)) {
      throw error
    }
    await writeFile(configPath, EMPTY_SETTINGS_JSON, 'utf-8')
  }

  return configPath
}

export async function ensureProjectSettingsFile(projectPath: string): Promise<string> {
  return ensureSettingsFile(projectPath, getProjectSettingsPath(projectPath))
}

async function updateProjectSettingsFile(
  configPath: string,
  updater: (current: ParsedProjectSettingsFile) => ParsedProjectSettingsFile,
): Promise<ParsedProjectSettingsFile> {
  const current =
    (await readValidatedProjectSettings(configPath, {
      strict: true,
      logLabel: '.openwaggle/settings.json',
    })) ?? decodeUnknownOrThrow(projectSettingsFileSchema, {})
  const next = decodeUnknownOrThrow(projectSettingsFileSchema, updater(current))

  const serialized = `${JSON.stringify(next, null, JSON_INDENT_SPACES)}\n`
  const tempPath = getConfigTempPath(configPath)

  try {
    await writeFile(tempPath, serialized, 'utf-8')
    await rename(tempPath, configPath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }

  return next
}

export async function updateProjectConfig(
  projectPath: string,
  updater: (current: ParsedProjectSettingsFile) => ParsedProjectSettingsFile,
): Promise<ProjectConfig> {
  const configPath = await ensureProjectSettingsFile(projectPath)
  const next = await updateProjectSettingsFile(configPath, updater)
  configCache.delete(projectPath)
  return parseProjectConfig(next)
}

export async function getProjectPreferences(
  projectPath: string,
): Promise<ProjectPreferences | undefined> {
  const config = await loadProjectConfig(projectPath)
  return config.preferences
}

export async function setProjectPreferences(
  projectPath: string,
  preferences: ProjectPreferences,
): Promise<void> {
  await updateProjectConfig(projectPath, (current) => ({
    ...current,
    preferences: {
      ...current.preferences,
      ...(preferences.model !== undefined ? { model: preferences.model } : {}),
      ...(preferences.thinkingLevel !== undefined
        ? { thinkingLevel: preferences.thinkingLevel }
        : {}),
    },
  }))
}

function parseProjectConfig(settings: ParsedProjectSettingsFile | null): ProjectConfig {
  const preferences: ProjectPreferences | undefined =
    settings?.preferences?.model || settings?.preferences?.thinkingLevel
      ? {
          ...(settings.preferences.model ? { model: settings.preferences.model } : {}),
          ...(settings.preferences.thinkingLevel
            ? { thinkingLevel: settings.preferences.thinkingLevel }
            : {}),
        }
      : undefined

  const wagglePresets = parseWagglePresets(settings?.wagglePresets)

  if (!preferences && wagglePresets.length === 0 && !settings?.pi) {
    return EMPTY_CONFIG
  }

  return {
    ...(preferences ? { preferences } : {}),
    ...(wagglePresets.length > 0 ? { wagglePresets } : {}),
    ...(settings?.pi ? { pi: settings.pi } : {}),
  }
}

function hydrateWagglePreset(raw: unknown): WagglePreset | null {
  const decoded = safeDecodeUnknown(wagglePresetSchema, raw)
  if (!decoded.success) {
    return null
  }

  const preset = decoded.data
  return {
    ...preset,
    id: WagglePresetId(preset.id),
    config: {
      ...preset.config,
      agents: [
        {
          ...preset.config.agents[0],
          model: SupportedModelId(preset.config.agents[0].model),
        },
        {
          ...preset.config.agents[1],
          model: SupportedModelId(preset.config.agents[1].model),
        },
      ],
    },
  }
}

function parseWagglePresets(rawPresets: readonly unknown[] | undefined): readonly WagglePreset[] {
  if (!rawPresets) {
    return []
  }

  const presets: WagglePreset[] = []
  for (const rawPreset of rawPresets) {
    const preset = hydrateWagglePreset(rawPreset)
    if (preset) {
      presets.push(preset)
    }
  }
  return presets
}
