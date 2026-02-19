import {
  DEFAULT_SETTINGS,
  PROVIDERS,
  type Provider,
  type ProviderConfig,
  type Settings,
} from '@shared/types/settings'
import Store from 'electron-store'
import { z } from 'zod'
import { providerRegistry } from '../providers'

const store = new Store<Settings>({
  name: 'settings',
  defaults: DEFAULT_SETTINGS,
})

/** Schema for validating raw provider config from disk */
const providerConfigSchema = z.object({
  apiKey: z.string().default(''),
  baseUrl: z.string().url().optional(),
  enabled: z.boolean().default(false),
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
        apiKey: parsed.data.apiKey,
        baseUrl: parsed.data.baseUrl ?? defaults.baseUrl,
        // Auto-enable if user already has an API key configured
        enabled: parsed.data.enabled || !!parsed.data.apiKey,
      }
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
  }
}

export function updateSettings(partial: Partial<Settings>): void {
  if (partial.providers !== undefined) {
    store.set('providers', partial.providers)
  }
  if (partial.defaultModel !== undefined) {
    store.set('defaultModel', partial.defaultModel)
  }
  if (partial.projectPath !== undefined) {
    store.set('projectPath', partial.projectPath)
  }
}
