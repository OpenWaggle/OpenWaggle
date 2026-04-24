import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import {
  decodeUnknownOrThrow,
  type Schema,
  type SchemaType,
  safeDecodeUnknown,
} from '@shared/schema'
import {
  projectLocalConfigSchema,
  projectSharedConfigSchema,
  type qualityTierSchema,
} from '@shared/schemas/validation'
import { formatErrorMessage, isEnoent } from '@shared/utils/node-error'
import { createLogger } from '../logger'

const CLAMP_OPTIONAL_ARG_3 = 2
const CLAMP_OPTIONAL_ARG_3_VALUE_1_000_000 = 1_000_000
const OPENWAGGLE_CONFIG_DIR = '.openwaggle'
const SHARED_PROJECT_CONFIG_FILE_NAME = 'config.toml'
const LOCAL_PROJECT_CONFIG_FILE_NAME = 'config.local.toml'
const EMPTY_CONFIG_TOML = ''
const LOCAL_CONFIG_GIT_EXCLUDE_ENTRY = '.openwaggle/config.local.toml'
const GIT_DIR_NAME = '.git'
const GIT_DIR_POINTER_PREFIX = 'gitdir:'

const logger = createLogger('project-config')

export interface BaseSamplingConfig {
  readonly temperature: number
  readonly topP: number
  readonly maxTokens: number
}

export interface ProjectQualityOverrides {
  readonly low?: Partial<BaseSamplingConfig>
  readonly medium?: Partial<BaseSamplingConfig>
  readonly high?: Partial<BaseSamplingConfig>
}

export interface ProjectPreferences {
  readonly model?: string
  readonly qualityPreset?: string
}

export interface ProjectConfig {
  readonly quality?: ProjectQualityOverrides
  readonly preferences?: ProjectPreferences
}

const EMPTY_CONFIG: ProjectConfig = {}
type ParsedProjectSharedConfig = SchemaType<typeof projectSharedConfigSchema>
type ParsedProjectLocalConfig = SchemaType<typeof projectLocalConfigSchema>

interface ConfigCacheEntry {
  readonly config: ProjectConfig
  readonly sharedMtime: number | null
  readonly localMtime: number | null
}

const configCache = new Map<string, ConfigCacheEntry>()

/** Clear cached configs — useful for tests and after known config edits. */
export function clearConfigCache(): void {
  configCache.clear()
}

function getConfigDirectoryPath(projectPath: string): string {
  return join(projectPath, OPENWAGGLE_CONFIG_DIR)
}

function getSharedConfigPath(projectPath: string): string {
  return join(getConfigDirectoryPath(projectPath), SHARED_PROJECT_CONFIG_FILE_NAME)
}

function getLocalConfigPath(projectPath: string): string {
  return join(getConfigDirectoryPath(projectPath), LOCAL_PROJECT_CONFIG_FILE_NAME)
}

function getConfigTempPath(configPath: string): string {
  return `${configPath}.${randomUUID()}.tmp`
}

async function readValidatedConfig<TSchema extends Schema.Schema.AnyNoContext>(
  filePath: string,
  schema: TSchema,
  options: {
    strict: boolean
    logLabel: string
  },
): Promise<SchemaType<TSchema> | null> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const { parse } = await import('smol-toml')
    const parsedToml: unknown = raw.trim().length > 0 ? parse(raw) : {}
    const validated = safeDecodeUnknown(schema, parsedToml)
    if (!validated.success) {
      const message = `Invalid project config schema: ${validated.issues.join('; ')}`
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

async function ensureLocalConfigGitExcludeBestEffort(projectPath: string): Promise<void> {
  try {
    await ensureLocalConfigGitExclude(projectPath)
  } catch (error) {
    logger.warn('Failed to update .git/info/exclude for local config', {
      error: formatErrorMessage(error),
    })
  }
}

export async function loadProjectConfig(projectPath: string): Promise<ProjectConfig> {
  const sharedConfigPath = getSharedConfigPath(projectPath)
  const localConfigPath = getLocalConfigPath(projectPath)

  let sharedMtime: number | null
  let localMtime: number | null

  try {
    ;[sharedMtime, localMtime] = await Promise.all([
      readConfigMtime(sharedConfigPath),
      readConfigMtime(localConfigPath),
    ])
  } catch (error) {
    logger.warn('Failed to stat project config files', {
      error: formatErrorMessage(error),
    })
    configCache.delete(projectPath)
    return EMPTY_CONFIG
  }

  const cached = configCache.get(projectPath)
  if (cached && cached.sharedMtime === sharedMtime && cached.localMtime === localMtime) {
    return cached.config
  }

  const [sharedConfig, localConfig] = await Promise.all([
    readValidatedConfig(sharedConfigPath, projectSharedConfigSchema, {
      strict: false,
      logLabel: '.openwaggle/config.toml',
    }),
    readValidatedConfig(localConfigPath, projectLocalConfigSchema, {
      strict: false,
      logLabel: '.openwaggle/config.local.toml',
    }),
  ])

  const mergedConfig = parseProjectConfig(sharedConfig, localConfig)
  configCache.set(projectPath, {
    config: mergedConfig,
    sharedMtime,
    localMtime,
  })

  return mergedConfig
}

async function ensureConfigFile(
  projectPath: string,
  configPath: string,
  afterCreate: (() => Promise<void>) | null,
): Promise<string> {
  const configDir = getConfigDirectoryPath(projectPath)

  await mkdir(configDir, { recursive: true })

  try {
    await stat(configPath)
  } catch (error) {
    if (!isEnoent(error)) {
      throw error
    }
    await writeFile(configPath, EMPTY_CONFIG_TOML, 'utf-8')
    if (afterCreate) {
      await afterCreate()
    }
  }

  return configPath
}

async function readGitDirFromPointerFile(gitPath: string): Promise<string | null> {
  const raw = await readFile(gitPath, 'utf-8')
  const firstLine = raw.split(/\r?\n/u, 1)[0]?.trim() ?? ''
  if (!firstLine.toLowerCase().startsWith(GIT_DIR_POINTER_PREFIX)) {
    return null
  }

  const relativeOrAbsolutePath = firstLine.slice(GIT_DIR_POINTER_PREFIX.length).trim()
  if (relativeOrAbsolutePath.length === 0) {
    return null
  }

  if (isAbsolute(relativeOrAbsolutePath)) {
    return relativeOrAbsolutePath
  }

  return resolve(dirname(gitPath), relativeOrAbsolutePath)
}

async function resolveGitDirectory(projectPath: string): Promise<string | null> {
  const gitPath = join(projectPath, GIT_DIR_NAME)

  try {
    const metadata = await stat(gitPath)
    if (metadata.isDirectory()) {
      return gitPath
    }
    if (!metadata.isFile()) {
      return null
    }

    return readGitDirFromPointerFile(gitPath)
  } catch (error) {
    if (isEnoent(error)) {
      return null
    }
    throw error
  }
}

async function ensureLocalConfigGitExclude(projectPath: string): Promise<void> {
  const gitDir = await resolveGitDirectory(projectPath)
  if (!gitDir) {
    return
  }

  const infoDir = join(gitDir, 'info')
  const excludePath = join(infoDir, 'exclude')

  await mkdir(infoDir, { recursive: true })

  let currentContent = ''
  try {
    currentContent = await readFile(excludePath, 'utf-8')
  } catch (error) {
    if (!isEnoent(error)) {
      throw error
    }
  }

  const hasEntry = currentContent
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .includes(LOCAL_CONFIG_GIT_EXCLUDE_ENTRY)
  if (hasEntry) {
    return
  }

  const lineBreak = currentContent.length === 0 || currentContent.endsWith('\n') ? '' : '\n'
  const nextContent = `${currentContent}${lineBreak}${LOCAL_CONFIG_GIT_EXCLUDE_ENTRY}\n`
  await writeFile(excludePath, nextContent, 'utf-8')
}

export async function ensureProjectConfigFile(projectPath: string): Promise<string> {
  return ensureConfigFile(projectPath, getSharedConfigPath(projectPath), null)
}

export async function ensureLocalProjectConfigFile(projectPath: string): Promise<string> {
  return ensureConfigFile(projectPath, getLocalConfigPath(projectPath), async () =>
    ensureLocalConfigGitExcludeBestEffort(projectPath),
  )
}

async function updateConfigFile<TSchema extends Schema.Schema.AnyNoContext>(
  configPath: string,
  schema: TSchema,
  logLabel: string,
  updater: (current: SchemaType<TSchema>) => SchemaType<TSchema>,
): Promise<SchemaType<TSchema>> {
  const current =
    (await readValidatedConfig(configPath, schema, {
      strict: true,
      logLabel,
    })) ?? decodeUnknownOrThrow(schema, {})
  const next = decodeUnknownOrThrow(schema, updater(current))

  const { stringify } = await import('smol-toml')
  const serialized = stringify(next)
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
  updater: (current: ParsedProjectSharedConfig) => ParsedProjectSharedConfig,
): Promise<ProjectConfig> {
  const configPath = await ensureProjectConfigFile(projectPath)
  const next = await updateConfigFile(
    configPath,
    projectSharedConfigSchema,
    '.openwaggle/config.toml',
    updater,
  )
  configCache.delete(projectPath)
  return parseProjectConfig(next, null)
}

async function updateLocalProjectConfig(
  projectPath: string,
  updater: (current: ParsedProjectLocalConfig) => ParsedProjectLocalConfig,
): Promise<ProjectConfig> {
  const configPath = await ensureLocalProjectConfigFile(projectPath)
  const next = await updateConfigFile(
    configPath,
    projectLocalConfigSchema,
    '.openwaggle/config.local.toml',
    updater,
  )
  configCache.delete(projectPath)
  return parseProjectConfig(null, next)
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
  await updateLocalProjectConfig(projectPath, (current) => ({
    ...current,
    preferences: {
      ...current.preferences,
      ...(preferences.model !== undefined ? { model: preferences.model } : {}),
      ...(preferences.qualityPreset !== undefined
        ? { quality_preset: preferences.qualityPreset }
        : {}),
    },
  }))
}

function parseProjectConfig(
  shared: ParsedProjectSharedConfig | null,
  local: ParsedProjectLocalConfig | null,
): ProjectConfig {
  const quality = shared?.quality

  const qualityOverrides: ProjectQualityOverrides = {
    low: parseTierOverride(quality?.low),
    medium: parseTierOverride(quality?.medium),
    high: parseTierOverride(quality?.high),
  }

  const hasQuality =
    qualityOverrides.low !== undefined ||
    qualityOverrides.medium !== undefined ||
    qualityOverrides.high !== undefined

  const preferences: ProjectPreferences | undefined =
    local?.preferences?.model || local?.preferences?.quality_preset
      ? {
          ...(local.preferences.model ? { model: local.preferences.model } : {}),
          ...(local.preferences.quality_preset
            ? { qualityPreset: local.preferences.quality_preset }
            : {}),
        }
      : undefined

  if (!hasQuality && !preferences) {
    return EMPTY_CONFIG
  }

  return {
    ...(hasQuality ? { quality: qualityOverrides } : {}),
    ...(preferences ? { preferences } : {}),
  }
}

function clampOptional(value: number, min: number, max: number, name: string): number | undefined {
  if (value >= min && value <= max) return value
  logger.warn(
    `config.toml: ${name} = ${String(value)} is out of range [${String(min)}, ${String(max)}], ignoring`,
  )
  return undefined
}

function parseTierOverride(
  tier: SchemaType<typeof qualityTierSchema> | undefined,
): Partial<BaseSamplingConfig> | undefined {
  if (!tier) return undefined

  const out: { temperature?: number; topP?: number; maxTokens?: number } = {}

  if (typeof tier.temperature === 'number') {
    const v = clampOptional(tier.temperature, 0, CLAMP_OPTIONAL_ARG_3, 'temperature')
    if (v !== undefined) out.temperature = v
  }
  if (typeof tier.top_p === 'number') {
    const v = clampOptional(tier.top_p, 0, 1, 'top_p')
    if (v !== undefined) out.topP = v
  }
  if (typeof tier.max_tokens === 'number') {
    const v = clampOptional(tier.max_tokens, 1, CLAMP_OPTIONAL_ARG_3_VALUE_1_000_000, 'max_tokens')
    if (v !== undefined) out.maxTokens = v
  }

  return Object.keys(out).length > 0 ? out : undefined
}
