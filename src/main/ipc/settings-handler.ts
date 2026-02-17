import { PROVIDERS, type Settings } from '@shared/types/settings'
import { chat } from '@tanstack/ai'
import { ipcMain } from 'electron'
import { z } from 'zod'
import { providerRegistry } from '../providers'
import { getSettings, updateSettings } from '../store/settings'

const TEST_TIMEOUT_MS = 15_000

async function testProviderApiKey(
  providerId: string,
  apiKey: string,
  baseUrl?: string,
): Promise<boolean> {
  const provider = providerRegistry.get(providerId)
  if (!provider) return false

  if (!provider.requiresApiKey) {
    // For Ollama: test connectivity by fetching model list
    if (provider.fetchModels) {
      const models = await provider.fetchModels(baseUrl)
      return models.length > 0
    }
    return true
  }

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), TEST_TIMEOUT_MS)

  try {
    const adapter = provider.createAdapter(provider.testModel, apiKey, baseUrl)
    const stream = chat({
      adapter,
      messages: [{ role: 'user', content: 'Hi' }],
      abortController,
    })
    for await (const _ of stream) {
      break // first chunk confirms the key works
    }
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

/** Schema for validating settings update payloads from the renderer */
const settingsUpdateSchema = z.object({
  providers: z
    .record(
      z.enum(PROVIDERS),
      z.object({
        apiKey: z.string(),
        baseUrl: z.string().optional(),
        enabled: z.boolean(),
      }),
    )
    .optional(),
  defaultModel: z.string().optional(),
  projectPath: z.string().nullable().optional(),
})

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', () => {
    return getSettings()
  })

  ipcMain.handle('settings:update', (_event, raw: unknown) => {
    const result = settingsUpdateSchema.safeParse(raw)
    if (!result.success) {
      console.warn('Invalid settings update payload:', result.error.message)
      return
    }
    updateSettings(result.data as Partial<Settings>)
  })

  ipcMain.handle(
    'settings:test-api-key',
    async (_event, provider: string, apiKey: string, baseUrl?: string) => {
      return testProviderApiKey(provider, apiKey, baseUrl)
    },
  )
}
