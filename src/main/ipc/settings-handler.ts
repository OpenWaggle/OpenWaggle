import { Schema, safeDecodeUnknown } from '@shared/schema'
import { AUTH_METHODS } from '@shared/types/auth'
import { SupportedModelId } from '@shared/types/brand'
import { EXECUTION_MODES, type PROVIDERS, QUALITY_PRESETS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { testCredentials } from '../application/provider-test-service'
import { createLogger } from '../logger'
import { SettingsService } from '../services/settings-service'
import { typedHandle } from './typed-ipc'

const logger = createLogger('ipc-settings')

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
  enabledModels: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
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
  typedHandle('settings:get', () =>
    Effect.gen(function* () {
      const settings = yield* SettingsService
      return yield* settings.get()
    }),
  )

  typedHandle('settings:update', (_event, raw: unknown) =>
    Effect.gen(function* () {
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

      const settings = yield* SettingsService
      yield* settings.update({
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

  typedHandle('settings:set-enabled-models', (_event, models: unknown) =>
    Effect.gen(function* () {
      if (!Array.isArray(models) || !models.every((m) => typeof m === 'string')) {
        logger.warn('Invalid enabled models payload', { models })
        return undefined
      }
      const settings = yield* SettingsService
      yield* settings.update({ enabledModels: models })
      return undefined
    }),
  )

  typedHandle(
    'settings:test-api-key',
    (
      _event,
      provider: string,
      apiKey: string,
      baseUrl?: string,
      authMethod?: 'api-key' | 'subscription',
    ) => testCredentials(provider, apiKey, baseUrl, authMethod),
  )
}
