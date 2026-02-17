import { DEFAULT_SETTINGS, type ProviderConfig, type Settings } from '@shared/types/settings'
import Store from 'electron-store'

const store = new Store<Settings>({
  name: 'settings',
  defaults: DEFAULT_SETTINGS,
})

export function getSettings(): Settings {
  const storedProviders = store.get('providers', {}) as Record<string, Partial<ProviderConfig>>
  const providers: Record<string, ProviderConfig> = {}

  for (const [id, defaults] of Object.entries(DEFAULT_SETTINGS.providers)) {
    if (!defaults) continue
    const existing = storedProviders[id]
    providers[id] = {
      apiKey: existing?.apiKey ?? defaults.apiKey,
      baseUrl: existing?.baseUrl ?? defaults.baseUrl,
      // Auto-enable if user already has an API key configured
      enabled: existing?.enabled ?? (existing?.apiKey ? true : defaults.enabled),
    }
  }

  return {
    providers,
    defaultModel: store.get('defaultModel', DEFAULT_SETTINGS.defaultModel),
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
