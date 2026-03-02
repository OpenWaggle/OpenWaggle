import { AUTH_METHODS } from '@shared/types/auth'
import { SupportedModelId } from '@shared/types/brand'
import { EXECUTION_MODES, PROVIDERS, QUALITY_PRESETS } from '@shared/types/settings'
import { chat } from '@tanstack/ai'
import { z } from 'zod'
import { createLogger } from '../logger'
import { providerRegistry } from '../providers'
import { getSettings, updateSettings } from '../store/settings'
import { safeHandle, typedHandle } from './typed-ipc'

const logger = createLogger('ipc-settings')

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
        for await (const chunk of stream) {
          if (chunk.type === 'RUN_ERROR') {
            return {
              success: false,
              error: chunk.error.message || 'Provider returned an error while testing credentials',
            } as const
          }
          if (chunk.type === 'RUN_FINISHED') {
            return { success: true } as const
          }
        }
        return { success: false, error: 'Connection closed before completion' } as const
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
        baseUrl: z.preprocess(
          (value) => (value === '' ? undefined : value),
          z.string().url().optional(),
        ),
        enabled: z.boolean(),
        authMethod: z.enum(AUTH_METHODS).optional(),
      }),
    )
    .optional(),
  defaultModel: z.string().optional(),
  favoriteModels: z.array(z.string()).optional(),
  projectPath: z.string().nullable().optional(),
  executionMode: z.enum(EXECUTION_MODES).optional(),
  qualityPreset: z.enum(QUALITY_PRESETS).optional(),
  recentProjects: z.array(z.string()).optional(),
  skillTogglesByProject: z.record(z.string(), z.record(z.string(), z.boolean())).optional(),
  projectDisplayNames: z.record(z.string(), z.string()).optional(),
})

export function registerSettingsHandlers(): void {
  typedHandle('settings:get', () => {
    return getSettings()
  })

  safeHandle('settings:update', (_event, raw: unknown) => {
    const result = settingsUpdateSchema.safeParse(raw)
    if (!result.success) {
      logger.warn('Invalid settings update payload', { error: result.error.message })
      return { ok: false as const, error: result.error.message }
    }
    updateSettings({
      ...result.data,
      defaultModel: result.data.defaultModel
        ? SupportedModelId(result.data.defaultModel)
        : undefined,
      favoriteModels: result.data.favoriteModels?.map(SupportedModelId),
    })
    return { ok: true as const }
  })

  typedHandle(
    'settings:test-api-key',
    async (_event, provider: string, apiKey: string, baseUrl?: string) => {
      return testProviderApiKey(provider, apiKey, baseUrl)
    },
  )
}
