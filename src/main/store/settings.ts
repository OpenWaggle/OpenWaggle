import {
  DEFAULT_SETTINGS,
  PROVIDERS,
  type Provider,
  type ProviderConfig,
  type Settings,
} from '@shared/types/settings'
import { safeStorage } from 'electron'
import Store from 'electron-store'
import { z } from 'zod'
import { providerRegistry } from '../providers'

const store = new Store<Settings>({
  name: 'settings',
  defaults: DEFAULT_SETTINGS,
})

const ENCRYPTED_PREFIX = 'enc:v1:'

/**
 * Schema for validating raw provider config from disk.
 * `enabled` is optional on disk (old configs may omit it); `getSettings()`
 * applies `defaults.enabled` to produce a `boolean` matching `ProviderConfig`.
 */
const providerConfigSchema = z.object({
  apiKey: z.string().default(''),
  baseUrl: z.string().url().optional(),
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

  return {
    providers,
    defaultModel,
    projectPath: store.get('projectPath', DEFAULT_SETTINGS.projectPath),
    executionMode: store.get('executionMode', DEFAULT_SETTINGS.executionMode),
  }
}

export function updateSettings(partial: Partial<Settings>): void {
  if (partial.providers !== undefined) {
    const encryptedProviders: Partial<Record<Provider, ProviderConfig>> = {}
    for (const id of PROVIDERS) {
      const config = partial.providers[id]
      if (!config) continue
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
    store.set('executionMode', partial.executionMode)
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
    console.warn('safeStorage encryption is unavailable — encrypted API keys cannot be decrypted.')
    return ''
  }

  const payload = storedApiKey.slice(ENCRYPTED_PREFIX.length)
  try {
    return safeStorage.decryptString(Buffer.from(payload, 'base64'))
  } catch {
    console.warn('Failed to decrypt API key — the stored value may be corrupted.')
    return ''
  }
}
