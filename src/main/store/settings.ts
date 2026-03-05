import { existsSync, readFileSync } from 'node:fs'
import { BASE_TEN, PERCENT_BASE } from '@shared/constants/constants'
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
import { safeStorage } from 'electron'
import Store from 'electron-store'
import { z } from 'zod'
import { createLogger } from '../logger'
import { providerRegistry } from '../providers'
import { decryptString, encryptString, isEncryptedString } from './encryption'

const logger = createLogger('settings')

const store = new Store<Settings>({
  name: 'settings',
  defaults: DEFAULT_SETTINGS,
})

/**
 * Schema for validating raw provider config from disk.
 * `enabled` is optional on disk (old configs may omit it); `getSettings()`
 * applies `defaults.enabled` to produce a `boolean` matching `ProviderConfig`.
 */
const providerConfigSchema = z.object({
  apiKey: z.string().default(''),
  baseUrl: z
    .string()
    .refine((v) => isValidBaseUrl(v), { message: 'Must be a valid http/https URL' })
    .optional(),
  enabled: z.boolean().optional(),
  authMethod: z.enum(AUTH_METHODS).default('api-key'),
})

const settingsValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.undefined(),
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(settingsValueSchema),
    z.record(z.string(), settingsValueSchema),
  ]),
)

const settingsObjectSchema = z.record(z.string(), settingsValueSchema)

export function getSettings(): Settings {
  const rawProviders: unknown = store.get('providers', {})
  const storedProviders = settingsObjectSchema.safeParse(rawProviders)
  const validProviders = storedProviders.success ? storedProviders.data : {}
  const providers: Partial<Record<Provider, ProviderConfig>> = {}
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  const migratedProviders: Partial<Record<Provider, ProviderConfig>> = {}
  let apiKeysRequireManualResave = false

  for (const id of PROVIDERS) {
    const defaults = DEFAULT_SETTINGS.providers[id]
    if (!defaults) continue

    const raw = validProviders[id]
    const parsed = providerConfigSchema.safeParse(raw)

    if (parsed.success) {
      const storedApiKey = parsed.data.apiKey
      const decryptedApiKey = decryptString(storedApiKey)
      providers[id] = {
        apiKey: decryptedApiKey,
        baseUrl: parsed.data.baseUrl ?? defaults.baseUrl,
        enabled: parsed.data.enabled ?? defaults.enabled,
        authMethod: parsed.data.authMethod,
      } satisfies ProviderConfig

      const shouldMigrate =
        encryptionAvailable && decryptedApiKey.trim().length > 0 && !isEncryptedString(storedApiKey)

      if (shouldMigrate) {
        const migratedApiKey = encryptString(decryptedApiKey)
        if (isEncryptedString(migratedApiKey)) {
          migratedProviders[id] = {
            apiKey: migratedApiKey,
            baseUrl: parsed.data.baseUrl ?? defaults.baseUrl,
            enabled: parsed.data.enabled ?? defaults.enabled,
            authMethod: parsed.data.authMethod,
          } satisfies ProviderConfig
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

  if (Object.keys(migratedProviders).length > 0) {
    store.set('providers', { ...validProviders, ...migratedProviders })
  }

  const rawDefaultModel = String(store.get('defaultModel', DEFAULT_SETTINGS.defaultModel))
  const defaultModel = providerRegistry.isKnownModel(rawDefaultModel)
    ? SupportedModelId(rawDefaultModel)
    : DEFAULT_SETTINGS.defaultModel
  if (defaultModel !== rawDefaultModel) {
    store.set('defaultModel', defaultModel)
  }

  const executionMode = resolveExecutionMode()
  const qualityPreset = resolveQualityPreset()
  const favoriteModels = resolveFavoriteModels()
  const recentProjects = resolveRecentProjects()
  const skillTogglesByProject = resolveSkillTogglesByProject()
  const mcpServers = resolveMcpServers()

  return {
    providers,
    defaultModel,
    favoriteModels,
    projectPath: store.get('projectPath', DEFAULT_SETTINGS.projectPath),
    executionMode,
    qualityPreset,
    recentProjects,
    skillTogglesByProject,
    mcpServers,
    projectDisplayNames: resolveProjectDisplayNames(),
    encryptionAvailable,
    apiKeysRequireManualResave,
  }
}

export function updateSettings(partial: Partial<Settings>): void {
  if (partial.providers !== undefined) {
    const rawExisting: unknown = store.get('providers', {})
    const parsedExisting = settingsObjectSchema.safeParse(rawExisting)
    const existingProviders = parsedExisting.success ? parsedExisting.data : {}

    const encryptedProviders: Partial<Record<Provider, ProviderConfig>> = {}
    for (const id of PROVIDERS) {
      const config = partial.providers[id]
      if (!config) continue

      if (config.baseUrl !== undefined && !isValidBaseUrl(config.baseUrl)) {
        logger.warn('Skipping invalid provider baseUrl', { provider: id, baseUrl: config.baseUrl })
        continue
      }

      const existingConfig = providerConfigSchema.safeParse(existingProviders[id])
      const defaults = DEFAULT_SETTINGS.providers[id]
      if (!defaults) continue

      encryptedProviders[id] = {
        apiKey: encryptString(config.apiKey),
        enabled: config.enabled,
        baseUrl:
          config.baseUrl ??
          (existingConfig.success ? existingConfig.data.baseUrl : defaults.baseUrl),
        authMethod:
          config.authMethod ??
          (existingConfig.success ? existingConfig.data.authMethod : defaults.authMethod),
      }
    }

    store.set('providers', { ...existingProviders, ...encryptedProviders })
  }
  if (partial.defaultModel !== undefined) {
    store.set('defaultModel', partial.defaultModel)
  }
  if (partial.favoriteModels !== undefined) {
    store.set('favoriteModels', sanitizeFavoriteModels(partial.favoriteModels))
  }
  if (partial.projectPath !== undefined) {
    store.set('projectPath', partial.projectPath)
  }
  if (partial.executionMode !== undefined) {
    if (includes(EXECUTION_MODES, partial.executionMode)) {
      store.set('executionMode', partial.executionMode)
    } else {
      logger.warn('Skipping invalid executionMode', { value: partial.executionMode })
    }
  }
  if (partial.qualityPreset !== undefined) {
    if (includes(QUALITY_PRESETS, partial.qualityPreset)) {
      store.set('qualityPreset', partial.qualityPreset)
    } else {
      logger.warn('Skipping invalid qualityPreset', { value: partial.qualityPreset })
    }
  }
  if (partial.recentProjects !== undefined) {
    store.set('recentProjects', sanitizeRecentProjects(partial.recentProjects))
  }
  if (partial.skillTogglesByProject !== undefined) {
    store.set('skillTogglesByProject', sanitizeSkillTogglesByProject(partial.skillTogglesByProject))
  }
  if (partial.mcpServers !== undefined) {
    store.set('mcpServers', sanitizeMcpServers(partial.mcpServers))
  }
  if (partial.projectDisplayNames !== undefined) {
    store.set('projectDisplayNames', sanitizeProjectDisplayNames(partial.projectDisplayNames))
  }
}

function resolveExecutionMode(): ExecutionMode {
  const persisted = readPersistedSettings()?.executionMode
  if (typeof persisted === 'string' && includes(EXECUTION_MODES, persisted)) {
    return persisted
  }

  const storedMode = store.get('executionMode', DEFAULT_SETTINGS.executionMode)
  if (includes(EXECUTION_MODES, storedMode)) {
    return storedMode
  }

  return DEFAULT_SETTINGS.executionMode
}

function resolveQualityPreset(): QualityPreset {
  const raw = store.get('qualityPreset', DEFAULT_SETTINGS.qualityPreset)
  return QUALITY_PRESETS.includes(raw) ? raw : DEFAULT_SETTINGS.qualityPreset
}

function resolveFavoriteModels(): SupportedModelId[] {
  return sanitizeFavoriteModels(store.get('favoriteModels', DEFAULT_SETTINGS.favoriteModels))
}

function resolveRecentProjects(): string[] {
  return sanitizeRecentProjects(store.get('recentProjects', DEFAULT_SETTINGS.recentProjects))
}

function resolveSkillTogglesByProject(): Record<string, Record<string, boolean>> {
  const stored = store.get('skillTogglesByProject', DEFAULT_SETTINGS.skillTogglesByProject)
  return sanitizeSkillTogglesByProject(stored)
}

function resolveProjectDisplayNames(): Record<string, string> {
  return sanitizeProjectDisplayNames(
    store.get('projectDisplayNames', DEFAULT_SETTINGS.projectDisplayNames),
  )
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

function resolveMcpServers(): McpServerConfig[] {
  const raw: unknown = store.get('mcpServers', DEFAULT_SETTINGS.mcpServers)
  if (!Array.isArray(raw)) return []
  return sanitizeMcpServers(raw)
}

function sanitizeMcpServers(servers: readonly unknown[]): McpServerConfig[] {
  const result: McpServerConfig[] = []
  for (const entry of servers) {
    const parsed = mcpServerConfigSchema.safeParse(entry)
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

  for (const path of paths) {
    const trimmed = path.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
    if (result.length >= BASE_TEN) break
  }

  return result
}

function sanitizeSkillTogglesByProject(
  value: Readonly<Record<string, Readonly<Record<string, boolean>>>>,
): Record<string, Record<string, boolean>> {
  const sanitized: Record<string, Record<string, boolean>> = {}

  for (const [rawProjectPath, toggles] of Object.entries(value)) {
    const projectPath = rawProjectPath.trim()
    if (!projectPath || !toggles) continue

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPersistedSettings(): Record<string, unknown> | null {
  try {
    if (!existsSync(store.path)) return null
    const raw = readFileSync(store.path, 'utf-8').trim()
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}
