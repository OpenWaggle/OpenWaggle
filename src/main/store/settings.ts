import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import Store from 'electron-store'

const store = new Store<Settings>({
  name: 'settings',
  defaults: DEFAULT_SETTINGS,
})

export function getSettings(): Settings {
  return {
    providers: store.get('providers', DEFAULT_SETTINGS.providers),
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
