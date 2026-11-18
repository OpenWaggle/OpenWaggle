import { Schema } from '@shared/schema'
import { supportedModelIdSchema } from '@shared/types/brand'
import { THINKING_LEVELS } from '@shared/types/settings'

/** The single source of the provider catalog types in `@shared/types/llm`. */

export const providerAuthSourceSchema = Schema.Literal(
  'none',
  'api-key',
  'oauth',
  'environment-or-custom',
)
export const providerApiKeyAuthSourceSchema = Schema.Literal(
  'none',
  'api-key',
  'environment-or-custom',
)

export const providerAuthInfoSchema = Schema.Struct({
  /** Provider-level active auth source as Pi will resolve it for model availability. */
  configured: Schema.Boolean,
  source: providerAuthSourceSchema,
  /** API-key section state only. OAuth credentials must not make this true. */
  apiKeyConfigured: Schema.Boolean,
  apiKeySource: providerApiKeyAuthSourceSchema,
  /** OAuth section state only. API keys and environment credentials must not make this true. */
  oauthConnected: Schema.Boolean,
  supportsApiKey: Schema.Boolean,
  supportsOAuth: Schema.Boolean,
  apiKeyPreview: Schema.optionalWith(Schema.String, { exact: true }),
})

/** Display info for UI, generated dynamically from Pi model metadata. */
export const modelDisplayInfoSchema = Schema.Struct({
  /** Canonical Pi model reference: "provider/modelId". */
  id: supportedModelIdSchema,
  /** Provider-local Pi model ID. This may itself contain slashes for hosted model routes. */
  modelId: Schema.String,
  name: Schema.String,
  provider: Schema.String,
  available: Schema.Boolean,
  /** Thinking levels available for this concrete provider/model selection. */
  availableThinkingLevels: Schema.Array(Schema.Literal(...THINKING_LEVELS)),
  /** Context window size in tokens (e.g., 200000, 1000000). Populated from provider metadata. */
  contextWindow: Schema.optionalWith(Schema.Number, { exact: true }),
  /**
   * A virtual model (a Pi router) picks a physical model for each request. Its own context window
   * is often unknown, so the context meter uses the window of the model that answered.
   */
  virtual: Schema.optionalWith(Schema.Boolean, { exact: true }),
})

/** Provider metadata exposed to the renderer via IPC. */
export const providerInfoSchema = Schema.Struct({
  provider: Schema.String,
  displayName: Schema.String,
  apiKeyManagementUrl: Schema.optionalWith(Schema.String, { exact: true }),
  auth: providerAuthInfoSchema,
  models: Schema.Array(modelDisplayInfoSchema),
})
