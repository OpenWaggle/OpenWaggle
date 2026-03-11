import { MILLISECONDS_PER_SECOND } from '@shared/constants/constants'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import { AUTH_METHODS } from '@shared/types/auth'
import { SupportedModelId } from '@shared/types/brand'
import { EXECUTION_MODES, type PROVIDERS, QUALITY_PRESETS } from '@shared/types/settings'
import { chat } from '@tanstack/ai'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { providerRegistry } from '../providers'
import { getSettings, updateSettings } from '../store/settings'
import { typedHandle } from './typed-ipc'

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
            }
          }
          if (chunk.type === 'RUN_FINISHED') {
            return { success: true }
          }
        }
        return { success: false, error: 'Connection closed before completion' }
      })(),
      new Promise<{ success: false; error: string }>((resolve) =>
        setTimeout(() => {
          abortController.abort()
          resolve({ success: false, error: 'Connection timed out' })
        }, TEST_TIMEOUT_MS + MILLISECONDS_PER_SECOND),
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
const providerUpdateSchema = Schema.Struct({
  apiKey: Schema.String,
  baseUrl: Schema.optional(Schema.String),
  enabled: Schema.Boolean,
  authMethod: Schema.optional(Schema.Literal(...AUTH_METHODS)),
})

const settingsProvidersUpdateSchema = Schema.Struct({
  anthropic: Schema.optional(providerUpdateSchema),
  openai: Schema.optional(providerUpdateSchema),
  gemini: Schema.optional(providerUpdateSchema),
  grok: Schema.optional(providerUpdateSchema),
  openrouter: Schema.optional(providerUpdateSchema),
  ollama: Schema.optional(providerUpdateSchema),
})

const settingsUpdateSchema = Schema.Struct({
  providers: Schema.optional(settingsProvidersUpdateSchema),
  defaultModel: Schema.optional(Schema.String),
  favoriteModels: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  projectPath: Schema.optional(Schema.NullOr(Schema.String)),
  executionMode: Schema.optional(Schema.Literal(...EXECUTION_MODES)),
  qualityPreset: Schema.optional(Schema.Literal(...QUALITY_PRESETS)),
  recentProjects: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  skillTogglesByProject: Schema.optional(
    Schema.mutable(
      Schema.Record({
        key: Schema.String,
        value: Schema.mutable(
          Schema.Record({
            key: Schema.String,
            value: Schema.Boolean,
          }),
        ),
      }),
    ),
  ),
  projectDisplayNames: Schema.optional(
    Schema.mutable(
      Schema.Record({
        key: Schema.String,
        value: Schema.String,
      }),
    ),
  ),
})

function normalizeProviderUpdates(
  providers: Schema.Schema.Type<typeof settingsProvidersUpdateSchema> | undefined,
):
  | Schema.Schema.Type<typeof settingsProvidersUpdateSchema>
  | { readonly error: string }
  | undefined {
  if (providers === undefined) {
    return undefined
  }

  const normalizedAnthropic = normalizeProviderUpdate(providers.anthropic, 'anthropic')
  if (hasProviderValidationError(normalizedAnthropic)) return normalizedAnthropic

  const normalizedOpenAi = normalizeProviderUpdate(providers.openai, 'openai')
  if (hasProviderValidationError(normalizedOpenAi)) return normalizedOpenAi

  const normalizedGemini = normalizeProviderUpdate(providers.gemini, 'gemini')
  if (hasProviderValidationError(normalizedGemini)) return normalizedGemini

  const normalizedGrok = normalizeProviderUpdate(providers.grok, 'grok')
  if (hasProviderValidationError(normalizedGrok)) return normalizedGrok

  const normalizedOpenRouter = normalizeProviderUpdate(providers.openrouter, 'openrouter')
  if (hasProviderValidationError(normalizedOpenRouter)) return normalizedOpenRouter

  const normalizedOllama = normalizeProviderUpdate(providers.ollama, 'ollama')
  if (hasProviderValidationError(normalizedOllama)) return normalizedOllama

  return {
    anthropic: normalizedAnthropic,
    openai: normalizedOpenAi,
    gemini: normalizedGemini,
    grok: normalizedGrok,
    openrouter: normalizedOpenRouter,
    ollama: normalizedOllama,
  }
}

function normalizeProviderUpdate(
  config: Schema.Schema.Type<typeof providerUpdateSchema> | undefined,
  provider: (typeof PROVIDERS)[number],
): Schema.Schema.Type<typeof providerUpdateSchema> | { readonly error: string } | undefined {
  if (!config) {
    return undefined
  }

  if (config.baseUrl === '') {
    return {
      ...config,
      baseUrl: undefined,
    }
  }

  if (config.baseUrl !== undefined && !URL.canParse(config.baseUrl)) {
    return { error: `providers.${provider}.baseUrl: Must be a valid http/https URL` }
  }

  return config
}

function hasProviderValidationError(
  value: Schema.Schema.Type<typeof providerUpdateSchema> | { readonly error: string } | undefined,
): value is { readonly error: string } {
  return typeof value === 'object' && value !== null && 'error' in value
}

export function registerSettingsHandlers(): void {
  typedHandle('settings:get', () => Effect.sync(() => getSettings()))

  typedHandle('settings:update', (_event, raw: unknown) =>
    Effect.sync(() => {
      const result = safeDecodeUnknown(settingsUpdateSchema, raw)
      if (!result.success) {
        const error = result.issues.join('; ')
        logger.warn('Invalid settings update payload', { error })
        return { ok: false, error } satisfies { ok: false; error: string }
      }

      const providers = normalizeProviderUpdates(result.data.providers)
      if (providers && 'error' in providers) {
        logger.warn('Invalid settings update payload', { error: providers.error })
        return { ok: false, error: providers.error } satisfies { ok: false; error: string }
      }

      updateSettings({
        ...result.data,
        providers,
        defaultModel: result.data.defaultModel
          ? SupportedModelId(result.data.defaultModel)
          : undefined,
        favoriteModels: result.data.favoriteModels?.map(SupportedModelId),
      })
      return { ok: true } satisfies { ok: true }
    }),
  )

  typedHandle(
    'settings:test-api-key',
    (_event, provider: string, apiKey: string, baseUrl?: string) =>
      Effect.promise(() => testProviderApiKey(provider, apiKey, baseUrl)),
  )
}
