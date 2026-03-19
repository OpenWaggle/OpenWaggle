import * as SqlClient from '@effect/sql/SqlClient'
import { BASE_TEN, PERCENT_BASE } from '@shared/constants/constants'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import { AUTH_METHODS } from '@shared/types/auth'
import { McpServerId, SupportedModelId } from '@shared/types/brand'
import type { McpServerConfig } from '@shared/types/mcp'
import { mcpServerConfigSchema } from '@shared/types/mcp'
import {
  DEFAULT_SETTINGS,
  EXECUTION_MODES,
  type ExecutionMode,
  PROVIDERS,
  type Provider,
  type ProviderConfig,
  QUALITY_PRESETS,
  type QualityPreset,
  type Settings,
} from '@shared/types/settings'
import { includes, isValidBaseUrl } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'
import { safeStorage } from 'electron'
import { createLogger } from '../logger'
import { providerRegistry } from '../providers'
import { runAppEffect } from '../runtime'
import { decryptString, encryptString, isEncryptedString } from './encryption'

const logger = createLogger('settings')

const SETTINGS_KEY_PROVIDERS = 'providers'
const SETTINGS_KEY_DEFAULT_MODEL = 'defaultModel'
const SETTINGS_KEY_FAVORITE_MODELS = 'favoriteModels'
const SETTINGS_KEY_PROJECT_PATH = 'projectPath'
const SETTINGS_KEY_EXECUTION_MODE = 'executionMode'
const SETTINGS_KEY_QUALITY_PRESET = 'qualityPreset'
const SETTINGS_KEY_RECENT_PROJECTS = 'recentProjects'
const SETTINGS_KEY_SKILL_TOGGLES_BY_PROJECT = 'skillTogglesByProject'
const SETTINGS_KEY_MCP_SERVERS = 'mcpServers'
const SETTINGS_KEY_ENABLED_MODELS = 'enabledModels'
const SETTINGS_KEY_PROJECT_DISPLAY_NAMES = 'projectDisplayNames'

interface SettingsStoreRow {
  readonly key: string
  readonly value_json: string
}

type SettingsValue =
  | undefined
  | string
  | number
  | boolean
  | null
  | SettingsValue[]
  | { [key: string]: SettingsValue }

/**
 * Schema for validating raw provider config from SQLite.
 * `enabled` is optional on disk so `getSettings()` can still apply defaults.
 */
const providerConfigSchema = Schema.Struct({
  apiKey: Schema.optional(Schema.String),
  baseUrl: Schema.optional(
    Schema.String.pipe(
      Schema.filter((value) => isValidBaseUrl(value) || 'Must be a valid http/https URL'),
    ),
  ),
  enabled: Schema.optional(Schema.Boolean),
  authMethod: Schema.optional(Schema.Literal(...AUTH_METHODS)),
})

const settingsValueSchema: Schema.Schema<SettingsValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.Undefined,
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.mutable(Schema.Array(settingsValueSchema)),
    Schema.mutable(Schema.Record({ key: Schema.String, value: settingsValueSchema })),
  ),
)

const settingsObjectSchema = Schema.mutable(
  Schema.Record({ key: Schema.String, value: settingsValueSchema }),
)

let settingsCache = createDefaultSettingsSnapshot()
let initializationPromise: Promise<void> | null = null
let writeQueue: Promise<void> = Promise.resolve()

function createDefaultSettingsSnapshot(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    providers: Object.fromEntries(
      PROVIDERS.map((provider) => [provider, { ...DEFAULT_SETTINGS.providers[provider] }]),
    ),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    apiKeysRequireManualResave: false,
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseJsonUnknown(raw: string): unknown {
  return JSON.parse(raw)
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === 'string' || value === null
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function listStoredSettings(): Promise<Record<string, unknown>> {
  const rows = await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql<SettingsStoreRow>`
        SELECT key, value_json
        FROM settings_store
      `
    }),
  )

  const stored: Record<string, unknown> = {}
  for (const row of rows) {
    try {
      stored[row.key] = parseJsonUnknown(row.value_json)
    } catch (error) {
      logger.warn('Failed to parse stored setting JSON', {
        key: row.key,
        error: describeError(error),
      })
    }
  }
  return stored
}

async function writeStoredSettingToDb(key: string, value: unknown): Promise<void> {
  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        INSERT INTO settings_store (key, value_json, updated_at)
        VALUES (${key}, ${JSON.stringify(value)}, ${Date.now()})
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `
    }),
  )
}

function queueStoredSettingWrite(key: string, value: unknown): void {
  writeQueue = writeQueue
    .then(() => writeStoredSettingToDb(key, value))
    .catch((error) => {
      logger.warn('Failed to write setting to SQLite', { key, error: describeError(error) })
    })
}

function getStoredValue(
  storedSettings: Readonly<Record<string, unknown>>,
  key: string,
): unknown | undefined {
  return Object.hasOwn(storedSettings, key) ? storedSettings[key] : undefined
}

function resolveProjectPath(raw: unknown): string | null {
  return isStringOrNull(raw) ? raw : DEFAULT_SETTINGS.projectPath
}

function parseEnabledModelKey(
  rawKey: string,
): { readonly provider: Provider; readonly modelId: string } | null {
  const parts = rawKey.split(':')
  const rawProvider = parts[0]
  const rawAuthMethod = parts[1]
  const modelId = parts.slice(2).join(':').trim()

  if (
    rawProvider === undefined ||
    rawAuthMethod === undefined ||
    !includes(PROVIDERS, rawProvider) ||
    (rawAuthMethod !== 'api-key' && rawAuthMethod !== 'subscription') ||
    modelId.length === 0
  ) {
    return null
  }

  return { provider: rawProvider, modelId }
}

function inferProviderForModel(
  modelId: string,
  enabledModels: readonly string[],
): Provider | undefined {
  for (const key of enabledModels) {
    const parsed = parseEnabledModelKey(key)
    if (parsed?.modelId === modelId) {
      return parsed.provider
    }
  }

  return undefined
}

function resolveDefaultModel(raw: unknown, enabledModels: readonly string[]): SupportedModelId {
  if (typeof raw !== 'string') {
    return DEFAULT_SETTINGS.defaultModel
  }

  const normalizedModel = raw.trim()
  if (!normalizedModel) {
    return DEFAULT_SETTINGS.defaultModel
  }

  if (providerRegistry.isKnownModel(normalizedModel)) {
    return SupportedModelId(normalizedModel)
  }

  const inferredProvider = inferProviderForModel(normalizedModel, enabledModels)
  if (!inferredProvider) {
    return DEFAULT_SETTINGS.defaultModel
  }

  const provider = providerRegistry.get(inferredProvider)
  if (!provider) {
    return DEFAULT_SETTINGS.defaultModel
  }

  providerRegistry.indexModels([normalizedModel], provider)
  return SupportedModelId(normalizedModel)
}

function buildSettingsSnapshot(storedSettings: Readonly<Record<string, unknown>>): {
  readonly settings: Settings
  readonly rawProviders: Record<string, unknown>
  readonly migratedProviders: Partial<Record<Provider, ProviderConfig>>
} {
  const rawProvidersValue = getStoredValue(storedSettings, SETTINGS_KEY_PROVIDERS) ?? {}
  const storedProviders = safeDecodeUnknown(settingsObjectSchema, rawProvidersValue)
  const validProviders = storedProviders.success ? storedProviders.data : {}
  const providers: Partial<Record<Provider, ProviderConfig>> = {}
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  const migratedProviders: Partial<Record<Provider, ProviderConfig>> = {}
  let apiKeysRequireManualResave = false

  for (const id of PROVIDERS) {
    const defaults = DEFAULT_SETTINGS.providers[id]
    if (!defaults) continue

    const raw = validProviders[id]
    const parsed = safeDecodeUnknown(providerConfigSchema, raw)

    if (parsed.success) {
      const storedApiKey = parsed.data.apiKey ?? ''
      const decryptedApiKey = decryptString(storedApiKey)
      providers[id] = {
        apiKey: decryptedApiKey,
        baseUrl: parsed.data.baseUrl ?? defaults.baseUrl,
        enabled: parsed.data.enabled ?? defaults.enabled,
        authMethod: parsed.data.authMethod ?? 'api-key',
      }

      const shouldMigrate =
        encryptionAvailable && decryptedApiKey.trim().length > 0 && !isEncryptedString(storedApiKey)

      if (shouldMigrate) {
        const migratedApiKey = encryptString(decryptedApiKey)
        if (isEncryptedString(migratedApiKey)) {
          migratedProviders[id] = {
            apiKey: migratedApiKey,
            baseUrl: parsed.data.baseUrl ?? defaults.baseUrl,
            enabled: parsed.data.enabled ?? defaults.enabled,
            authMethod: parsed.data.authMethod ?? 'api-key',
          }
        } else {
          apiKeysRequireManualResave = true
          logger.warn('Failed to auto-migrate plaintext API key; manual re-save required', {
            provider: id,
          })
        }
      }
    } else {
      providers[id] = { ...defaults }
    }
  }

  const executionMode = resolveExecutionMode(
    getStoredValue(storedSettings, SETTINGS_KEY_EXECUTION_MODE),
  )
  const qualityPreset = resolveQualityPreset(
    getStoredValue(storedSettings, SETTINGS_KEY_QUALITY_PRESET),
  )
  const favoriteModels = resolveFavoriteModels(
    getStoredValue(storedSettings, SETTINGS_KEY_FAVORITE_MODELS),
  )
  const recentProjects = resolveRecentProjects(
    getStoredValue(storedSettings, SETTINGS_KEY_RECENT_PROJECTS),
  )
  const skillTogglesByProject = resolveSkillTogglesByProject(
    getStoredValue(storedSettings, SETTINGS_KEY_SKILL_TOGGLES_BY_PROJECT),
  )
  const enabledModels = resolveEnabledModels(
    getStoredValue(storedSettings, SETTINGS_KEY_ENABLED_MODELS),
  )
  const defaultModel = resolveDefaultModel(
    getStoredValue(storedSettings, SETTINGS_KEY_DEFAULT_MODEL),
    enabledModels,
  )
  const mcpServers = resolveMcpServers(getStoredValue(storedSettings, SETTINGS_KEY_MCP_SERVERS))
  const projectDisplayNames = sanitizeProjectDisplayNames(
    getStoredValue(storedSettings, SETTINGS_KEY_PROJECT_DISPLAY_NAMES) ??
      DEFAULT_SETTINGS.projectDisplayNames,
  )

  return {
    settings: {
      providers,
      defaultModel,
      favoriteModels,
      enabledModels,
      projectPath: resolveProjectPath(getStoredValue(storedSettings, SETTINGS_KEY_PROJECT_PATH)),
      executionMode,
      qualityPreset,
      recentProjects,
      skillTogglesByProject,
      mcpServers,
      projectDisplayNames,
      encryptionAvailable,
      apiKeysRequireManualResave,
    },
    rawProviders: validProviders,
    migratedProviders,
  }
}

function serializeProviders(
  providers: Readonly<Partial<Record<Provider, ProviderConfig>>>,
): Partial<Record<Provider, ProviderConfig>> {
  const serialized: Partial<Record<Provider, ProviderConfig>> = {}
  for (const id of PROVIDERS) {
    const config = providers[id]
    if (!config) continue
    serialized[id] = {
      apiKey: encryptString(config.apiKey),
      enabled: config.enabled,
      baseUrl: config.baseUrl,
      authMethod: config.authMethod,
    }
  }
  return serialized
}

export async function initializeSettingsStore(): Promise<void> {
  if (initializationPromise) {
    return initializationPromise
  }

  initializationPromise = (async () => {
    try {
      const storedSettings = await listStoredSettings()
      const built = buildSettingsSnapshot(storedSettings)
      settingsCache = built.settings

      if (Object.keys(built.migratedProviders).length > 0) {
        queueStoredSettingWrite(SETTINGS_KEY_PROVIDERS, {
          ...built.rawProviders,
          ...built.migratedProviders,
        })
      }

      if (built.settings.defaultModel !== storedSettings[SETTINGS_KEY_DEFAULT_MODEL]) {
        queueStoredSettingWrite(SETTINGS_KEY_DEFAULT_MODEL, built.settings.defaultModel)
      }
    } catch (error) {
      logger.warn('Failed to initialize settings cache from SQLite', {
        error: describeError(error),
      })
      settingsCache = createDefaultSettingsSnapshot()
    }
  })()

  await initializationPromise
}

export async function flushSettingsStoreForTests(): Promise<void> {
  await writeQueue
}

export function getSettings(): Settings {
  return settingsCache
}

export function updateSettings(partial: Partial<Settings>): void {
  const nextProviders: Partial<Record<Provider, ProviderConfig>> = {
    ...settingsCache.providers,
  }

  if (partial.providers !== undefined) {
    for (const id of PROVIDERS) {
      const config = partial.providers[id]
      if (!config) continue

      if (config.baseUrl !== undefined && !isValidBaseUrl(config.baseUrl)) {
        logger.warn('Skipping invalid provider baseUrl', { provider: id, baseUrl: config.baseUrl })
        continue
      }

      const existing = nextProviders[id] ?? DEFAULT_SETTINGS.providers[id]
      nextProviders[id] = {
        apiKey: config.apiKey,
        enabled: config.enabled,
        baseUrl: config.baseUrl ?? existing?.baseUrl,
        authMethod:
          config.authMethod ?? existing?.authMethod ?? DEFAULT_SETTINGS.providers[id]?.authMethod,
      }
    }

    queueStoredSettingWrite(SETTINGS_KEY_PROVIDERS, serializeProviders(nextProviders))
  }

  const defaultModel = partial.defaultModel ?? settingsCache.defaultModel
  const favoriteModels =
    partial.favoriteModels !== undefined
      ? sanitizeFavoriteModels(partial.favoriteModels)
      : settingsCache.favoriteModels
  const projectPath =
    partial.projectPath !== undefined ? partial.projectPath : settingsCache.projectPath
  const executionMode =
    partial.executionMode !== undefined && includes(EXECUTION_MODES, partial.executionMode)
      ? partial.executionMode
      : settingsCache.executionMode
  const qualityPreset =
    partial.qualityPreset !== undefined && includes(QUALITY_PRESETS, partial.qualityPreset)
      ? partial.qualityPreset
      : settingsCache.qualityPreset
  const recentProjects =
    partial.recentProjects !== undefined
      ? sanitizeRecentProjects(partial.recentProjects)
      : settingsCache.recentProjects
  const skillTogglesByProject =
    partial.skillTogglesByProject !== undefined
      ? sanitizeSkillTogglesByProject(partial.skillTogglesByProject)
      : settingsCache.skillTogglesByProject
  const enabledModels =
    partial.enabledModels !== undefined
      ? sanitizeEnabledModels(partial.enabledModels)
      : settingsCache.enabledModels
  const mcpServers =
    partial.mcpServers !== undefined
      ? sanitizeMcpServers(partial.mcpServers)
      : settingsCache.mcpServers
  const projectDisplayNames =
    partial.projectDisplayNames !== undefined
      ? sanitizeProjectDisplayNames(partial.projectDisplayNames)
      : settingsCache.projectDisplayNames

  settingsCache = {
    ...settingsCache,
    providers: nextProviders,
    defaultModel,
    favoriteModels,
    enabledModels,
    projectPath,
    executionMode,
    qualityPreset,
    recentProjects,
    skillTogglesByProject,
    mcpServers,
    projectDisplayNames,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    apiKeysRequireManualResave: false,
  }

  if (partial.defaultModel !== undefined) {
    queueStoredSettingWrite(SETTINGS_KEY_DEFAULT_MODEL, partial.defaultModel)
  }
  if (partial.favoriteModels !== undefined) {
    queueStoredSettingWrite(SETTINGS_KEY_FAVORITE_MODELS, favoriteModels)
  }
  if (partial.projectPath !== undefined) {
    queueStoredSettingWrite(SETTINGS_KEY_PROJECT_PATH, partial.projectPath)
  }
  if (partial.executionMode !== undefined) {
    if (includes(EXECUTION_MODES, partial.executionMode)) {
      queueStoredSettingWrite(SETTINGS_KEY_EXECUTION_MODE, partial.executionMode)
    } else {
      logger.warn('Skipping invalid executionMode', { value: partial.executionMode })
    }
  }
  if (partial.qualityPreset !== undefined) {
    if (includes(QUALITY_PRESETS, partial.qualityPreset)) {
      queueStoredSettingWrite(SETTINGS_KEY_QUALITY_PRESET, partial.qualityPreset)
    } else {
      logger.warn('Skipping invalid qualityPreset', { value: partial.qualityPreset })
    }
  }
  if (partial.recentProjects !== undefined) {
    queueStoredSettingWrite(SETTINGS_KEY_RECENT_PROJECTS, recentProjects)
  }
  if (partial.skillTogglesByProject !== undefined) {
    queueStoredSettingWrite(SETTINGS_KEY_SKILL_TOGGLES_BY_PROJECT, skillTogglesByProject)
  }
  if (partial.enabledModels !== undefined) {
    queueStoredSettingWrite(SETTINGS_KEY_ENABLED_MODELS, enabledModels)
  }
  if (partial.mcpServers !== undefined) {
    queueStoredSettingWrite(SETTINGS_KEY_MCP_SERVERS, mcpServers)
  }
  if (partial.projectDisplayNames !== undefined) {
    queueStoredSettingWrite(SETTINGS_KEY_PROJECT_DISPLAY_NAMES, projectDisplayNames)
  }
}

function resolveExecutionMode(raw: unknown): ExecutionMode {
  return typeof raw === 'string' && includes(EXECUTION_MODES, raw)
    ? raw
    : DEFAULT_SETTINGS.executionMode
}

function resolveQualityPreset(raw: unknown): QualityPreset {
  return typeof raw === 'string' && includes(QUALITY_PRESETS, raw)
    ? raw
    : DEFAULT_SETTINGS.qualityPreset
}

function resolveEnabledModels(raw: unknown): string[] {
  return Array.isArray(raw) && raw.every((value) => typeof value === 'string')
    ? sanitizeEnabledModels(raw)
    : [...DEFAULT_SETTINGS.enabledModels]
}

function sanitizeEnabledModels(models: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const model of models) {
    const trimmed = model.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

function resolveFavoriteModels(raw: unknown): SupportedModelId[] {
  return Array.isArray(raw) && raw.every((value) => typeof value === 'string')
    ? sanitizeFavoriteModels(raw)
    : [...DEFAULT_SETTINGS.favoriteModels]
}

function resolveRecentProjects(raw: unknown): string[] {
  return Array.isArray(raw) && raw.every((value) => typeof value === 'string')
    ? sanitizeRecentProjects(raw)
    : [...DEFAULT_SETTINGS.recentProjects]
}

function resolveSkillTogglesByProject(raw: unknown): Record<string, Record<string, boolean>> {
  return isObjectRecord(raw)
    ? sanitizeSkillTogglesByProject(raw)
    : DEFAULT_SETTINGS.skillTogglesByProject
}

function sanitizeProjectDisplayNames(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key === 'string' && typeof value === 'string') {
      result[key] = value
    }
  }
  return result
}

function resolveMcpServers(raw: unknown): McpServerConfig[] {
  if (!Array.isArray(raw)) return []
  return sanitizeMcpServers(raw)
}

function sanitizeMcpServers(servers: readonly unknown[]): McpServerConfig[] {
  const result: McpServerConfig[] = []
  for (const entry of servers) {
    const parsed = safeDecodeUnknown(mcpServerConfigSchema, entry)
    if (parsed.success) {
      result.push({
        ...parsed.data,
        id: McpServerId(parsed.data.id),
      })
    } else {
      logger.warn('Skipping invalid MCP server config', { entry })
    }
  }
  return result
}

function sanitizeFavoriteModels(models: readonly string[]): SupportedModelId[] {
  const seen = new Set<string>()
  const result: SupportedModelId[] = []

  for (const model of models) {
    const trimmed = model.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(SupportedModelId(trimmed))
    if (result.length >= PERCENT_BASE) break
  }

  return result
}

function sanitizeRecentProjects(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const projectPath of paths) {
    const trimmed = projectPath.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
    if (result.length >= BASE_TEN) break
  }

  return result
}

function sanitizeSkillTogglesByProject(
  value: Readonly<Record<string, unknown>>,
): Record<string, Record<string, boolean>> {
  const sanitized: Record<string, Record<string, boolean>> = {}

  for (const [rawProjectPath, toggles] of Object.entries(value)) {
    const projectPath = rawProjectPath.trim()
    if (!projectPath || !isObjectRecord(toggles)) continue

    const nextToggles: Record<string, boolean> = {}
    for (const [rawSkillId, enabled] of Object.entries(toggles)) {
      const skillId = rawSkillId.trim()
      if (!skillId || typeof enabled !== 'boolean') continue
      nextToggles[skillId] = enabled
    }

    if (Object.keys(nextToggles).length > 0) {
      sanitized[projectPath] = nextToggles
    }
  }

  return sanitized
}
