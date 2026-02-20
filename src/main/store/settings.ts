import fs from 'node:fs'
import {
  DEFAULT_SETTINGS,
  EXECUTION_MODES,
  type ExecutionMode,
  ORCHESTRATION_MODES,
  type OrchestrationMode,
  PROVIDERS,
  type Provider,
  type ProviderConfig,
  QUALITY_PRESETS,
  type QualityPreset,
  type Settings,
} from '@shared/types/settings'
import { isValidBaseUrl } from '@shared/utils/validation'
import { safeStorage } from 'electron'
import Store from 'electron-store'
import { z } from 'zod'
import { createLogger } from '../logger'
import { providerRegistry } from '../providers'

const logger = createLogger('settings')

const store = new Store<Settings>({
  name: 'settings',
  defaults: DEFAULT_SETTINGS,
})

const ENCRYPTED_PREFIX = 'enc:v1:'
const LEGACY_EXECUTION_MODE: ExecutionMode = 'full-access'

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
})

export function getSettings(): Settings {
  const storedProviders = store.get('providers', {}) as Record<string, unknown>
  const providers: Partial<Record<Provider, ProviderConfig>> = {}

  for (const id of PROVIDERS) {
    const defaults = DEFAULT_SETTINGS.providers[id]
    if (!defaults) continue

    const raw = storedProviders[id]
    const parsed = providerConfigSchema.safeParse(raw)

    if (parsed.success) {
      providers[id] = {
        apiKey: decryptApiKey(parsed.data.apiKey),
        baseUrl: parsed.data.baseUrl ?? defaults.baseUrl,
        enabled: parsed.data.enabled ?? defaults.enabled,
      } satisfies ProviderConfig
    } else {
      providers[id] = { ...defaults }
    }
  }

  const rawDefaultModel = store.get('defaultModel', DEFAULT_SETTINGS.defaultModel)
  const defaultModel = providerRegistry.isKnownModel(rawDefaultModel)
    ? rawDefaultModel
    : DEFAULT_SETTINGS.defaultModel
  if (defaultModel !== rawDefaultModel) {
    store.set('defaultModel', defaultModel)
  }

  const executionMode = resolveExecutionMode()
  const orchestrationMode = resolveOrchestrationMode()
  const qualityPreset = resolveQualityPreset()
  const recentProjects = resolveRecentProjects()
  const skillTogglesByProject = resolveSkillTogglesByProject()

  return {
    providers,
    defaultModel,
    projectPath: store.get('projectPath', DEFAULT_SETTINGS.projectPath),
    executionMode,
    orchestrationMode,
    qualityPreset,
    recentProjects,
    skillTogglesByProject,
  }
}

export function updateSettings(partial: Partial<Settings>): void {
  if (partial.providers !== undefined) {
    const encryptedProviders: Partial<Record<Provider, ProviderConfig>> = {}
    for (const id of PROVIDERS) {
      const config = partial.providers[id]
      if (!config) continue

      if (config.baseUrl !== undefined && !isValidBaseUrl(config.baseUrl)) {
        logger.warn('Skipping invalid provider baseUrl', { provider: id, baseUrl: config.baseUrl })
        continue
      }

      encryptedProviders[id] = {
        ...config,
        apiKey: encryptApiKey(config.apiKey),
      }
    }
    const existingProviders = store.get('providers', {}) as Record<string, unknown>
    store.set('providers', { ...existingProviders, ...encryptedProviders })
  }
  if (partial.defaultModel !== undefined) {
    store.set('defaultModel', partial.defaultModel)
  }
  if (partial.projectPath !== undefined) {
    store.set('projectPath', partial.projectPath)
  }
  if (partial.executionMode !== undefined) {
    if ((EXECUTION_MODES as readonly string[]).includes(partial.executionMode)) {
      store.set('executionMode', partial.executionMode)
    } else {
      logger.warn('Skipping invalid executionMode', { value: partial.executionMode })
    }
  }
  if (partial.orchestrationMode !== undefined) {
    if ((ORCHESTRATION_MODES as readonly string[]).includes(partial.orchestrationMode)) {
      store.set('orchestrationMode', partial.orchestrationMode)
    } else {
      logger.warn('Skipping invalid orchestrationMode', { value: partial.orchestrationMode })
    }
  }
  if (partial.qualityPreset !== undefined) {
    if ((QUALITY_PRESETS as readonly string[]).includes(partial.qualityPreset)) {
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
}

function resolveExecutionMode(): ExecutionMode {
  const persisted = readPersistedSettings()
  const persistedExecutionMode = persisted?.executionMode
  if (
    typeof persistedExecutionMode === 'string' &&
    (EXECUTION_MODES as readonly string[]).includes(persistedExecutionMode)
  ) {
    return persistedExecutionMode as ExecutionMode
  }

  // Keep existing profiles on the legacy default while new installs use sandbox.
  const hasLegacyProfile =
    persisted !== null &&
    ('providers' in persisted || 'defaultModel' in persisted || 'projectPath' in persisted)
  if (hasLegacyProfile) {
    store.set('executionMode', LEGACY_EXECUTION_MODE)
    return LEGACY_EXECUTION_MODE
  }

  return DEFAULT_SETTINGS.executionMode
}

function resolveOrchestrationMode(): OrchestrationMode {
  const raw = store.get('orchestrationMode', DEFAULT_SETTINGS.orchestrationMode)
  return ORCHESTRATION_MODES.includes(raw) ? raw : DEFAULT_SETTINGS.orchestrationMode
}

function resolveQualityPreset(): QualityPreset {
  const raw = store.get('qualityPreset', DEFAULT_SETTINGS.qualityPreset)
  return QUALITY_PRESETS.includes(raw) ? raw : DEFAULT_SETTINGS.qualityPreset
}

function resolveRecentProjects(): string[] {
  return sanitizeRecentProjects(store.get('recentProjects', DEFAULT_SETTINGS.recentProjects))
}

function resolveSkillTogglesByProject(): Record<string, Record<string, boolean>> {
  const stored = store.get('skillTogglesByProject', DEFAULT_SETTINGS.skillTogglesByProject)
  return sanitizeSkillTogglesByProject(stored)
}

function sanitizeRecentProjects(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const path of paths) {
    const trimmed = path.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
    if (result.length >= 10) break
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

function readPersistedSettings(): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(store.path)) return null
    const raw = fs.readFileSync(store.path, 'utf-8').trim()
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function encryptApiKey(apiKey: string): string {
  if (!apiKey) return ''
  if (!safeStorage.isEncryptionAvailable()) return apiKey
  try {
    const encrypted = safeStorage.encryptString(apiKey)
    return `${ENCRYPTED_PREFIX}${encrypted.toString('base64')}`
  } catch {
    return apiKey
  }
}

function decryptApiKey(storedApiKey: string): string {
  if (!storedApiKey) return ''
  if (!storedApiKey.startsWith(ENCRYPTED_PREFIX)) return storedApiKey
  if (!safeStorage.isEncryptionAvailable()) {
    logger.warn('safeStorage encryption is unavailable — encrypted API keys cannot be decrypted.')
    return ''
  }

  const payload = storedApiKey.slice(ENCRYPTED_PREFIX.length)
  try {
    return safeStorage.decryptString(Buffer.from(payload, 'base64'))
  } catch {
    logger.warn('Failed to decrypt API key — the stored value may be corrupted.')
    return ''
  }
}
