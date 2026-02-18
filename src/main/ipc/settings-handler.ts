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
): Promise<{ success: boolean; error?: string }> {
  const provider = providerRegistry.get(providerId)
  if (!provider) return { success: false, error: `Unknown provider: ${providerId}` }

  if (!provider.requiresApiKey) {
    // For Ollama: test connectivity by fetching model list
    if (provider.fetchModels) {
      try {
        const models = await Promise.race([
          provider.fetchModels(baseUrl),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Connection timed out')), TEST_TIMEOUT_MS),
          ),
        ])
        return models.length > 0
          ? { success: true }
          : { success: false, error: 'No models found — is the service running?' }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
    return { success: true }
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

    const result = await Promise.race([
      (async () => {
        for await (const _ of stream) {
          break // first chunk confirms the key works
        }
        return { success: true } as const
      })(),
      new Promise<{ success: false; error: string }>((resolve) =>
        setTimeout(() => {
          abortController.abort()
          resolve({ success: false, error: 'Connection timed out' })
        }, TEST_TIMEOUT_MS + 1000),
      ),
    ])
    return result
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
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
