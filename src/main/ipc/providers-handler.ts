import { generateDisplayName } from '@shared/types/llm'
import { ipcMain } from 'electron'
import { providerRegistry } from '../providers'

export function registerProvidersHandlers(): void {
  ipcMain.handle('providers:get-models', () => {
    return providerRegistry.getAll().map((p) => ({
      provider: p.id,
      displayName: p.displayName,
      models: p.models.map((m) => ({
        id: m,
        name: generateDisplayName(m),
        provider: p.id,
      })),
    }))
  })
}
