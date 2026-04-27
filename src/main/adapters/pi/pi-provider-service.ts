import type { ProviderApiKeyAuthSource, ProviderAuthSource } from '@shared/types/llm'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { ProviderLookupError } from '../../errors'
import {
  type ProviderCapabilities,
  type ProviderModelCapabilities,
  ProviderService,
} from '../../ports/provider-service'
import {
  createPiProviderCatalogSnapshot,
  getBuiltInPiModelProviderIds,
} from './pi-provider-catalog'

function toDisplayName(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function toModelCapabilities(model: {
  readonly ref: string
  readonly id: string
  readonly name: string
  readonly available: boolean
  readonly reasoning: boolean
  readonly availableThinkingLevels: ProviderModelCapabilities['availableThinkingLevels']
  readonly input: readonly ('text' | 'image')[]
  readonly contextWindow: number
  readonly maxTokens: number
}): ProviderModelCapabilities {
  return {
    id: model.ref,
    modelId: model.id,
    name: model.name,
    available: model.available,
    reasoning: model.reasoning,
    availableThinkingLevels: model.availableThinkingLevels,
    input: [...model.input],
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  }
}

// Pi's TUI exposes OAuth providers from AuthStorage, but keeps the built-in API-key
// login provider names in the interactive layer. Until Pi exposes that list through
// the SDK, this adapter-local mirror is intentionally kept aligned with Pi TUI.
const PI_API_KEY_AUTH_PROVIDER_DISPLAY_NAMES: ReadonlyMap<string, string> = new Map([
  ['amazon-bedrock', 'Amazon Bedrock'],
  ['anthropic', 'Anthropic'],
  ['azure-openai-responses', 'Azure OpenAI Responses'],
  ['cerebras', 'Cerebras'],
  ['deepseek', 'DeepSeek'],
  ['fireworks', 'Fireworks'],
  ['google', 'Google Gemini'],
  ['google-vertex', 'Google Vertex AI'],
  ['groq', 'Groq'],
  ['huggingface', 'Hugging Face'],
  ['kimi-coding', 'Kimi For Coding'],
  ['minimax', 'MiniMax'],
  ['minimax-cn', 'MiniMax (China)'],
  ['mistral', 'Mistral'],
  ['opencode', 'OpenCode Zen'],
  ['opencode-go', 'OpenCode Go'],
  ['openai', 'OpenAI'],
  ['openrouter', 'OpenRouter'],
  ['vercel-ai-gateway', 'Vercel AI Gateway'],
  ['xai', 'xAI'],
  ['zai', 'ZAI'],
])

function getPiProviderDisplayName(
  providerId: string,
  oauthProviderNames: ReadonlyMap<string, string>,
): string {
  return (
    oauthProviderNames.get(providerId) ??
    PI_API_KEY_AUTH_PROVIDER_DISPLAY_NAMES.get(providerId) ??
    toDisplayName(providerId)
  )
}

export function supportsPiApiKeyAuthProvider(
  providerId: string,
  apiKeySource: ProviderApiKeyAuthSource,
  oauthProviders: ReadonlySet<string> = new Set(),
  builtInModelProviders: ReadonlySet<string> = getBuiltInPiModelProviderIds(),
): boolean {
  if (apiKeySource !== 'none') {
    return true
  }
  if (PI_API_KEY_AUTH_PROVIDER_DISPLAY_NAMES.has(providerId)) {
    return true
  }
  if (builtInModelProviders.has(providerId)) {
    return false
  }
  return !oauthProviders.has(providerId)
}

function toCapabilities(provider: {
  readonly provider: string
  readonly models: readonly Parameters<typeof toModelCapabilities>[0][]
  readonly oauthProviders: ReadonlySet<string>
  readonly oauthProviderNames: ReadonlyMap<string, string>
  readonly credentials: ReadonlyMap<string, { readonly type: string }>
  readonly configuredAuthProviders: ReadonlySet<string>
  readonly builtInModelProviders: ReadonlySet<string>
}): ProviderCapabilities {
  const credential = provider.credentials.get(provider.provider)
  const hasConfiguredAuth = provider.configuredAuthProviders.has(provider.provider)
  const source: ProviderAuthSource =
    credential?.type === 'api_key'
      ? 'api-key'
      : credential?.type === 'oauth'
        ? 'oauth'
        : hasConfiguredAuth
          ? 'environment-or-custom'
          : 'none'
  const apiKeySource: ProviderApiKeyAuthSource =
    credential?.type === 'api_key'
      ? 'api-key'
      : credential
        ? 'none'
        : hasConfiguredAuth
          ? 'environment-or-custom'
          : 'none'
  return {
    id: provider.provider,
    displayName: getPiProviderDisplayName(provider.provider, provider.oauthProviderNames),
    auth: {
      configured: source !== 'none',
      source,
      apiKeyConfigured: apiKeySource !== 'none',
      apiKeySource,
      oauthConnected: credential?.type === 'oauth',
      supportsApiKey: supportsPiApiKeyAuthProvider(
        provider.provider,
        apiKeySource,
        provider.oauthProviders,
        provider.builtInModelProviders,
      ),
      supportsOAuth: provider.oauthProviders.has(provider.provider),
    },
    models: provider.models.map(toModelCapabilities),
    testModel: provider.models[0]?.id ?? '',
  }
}

export const ProviderServiceLive = Layer.succeed(
  ProviderService,
  ProviderService.of({
    get: (providerId, projectPath) =>
      Effect.promise(async () => {
        const snapshot = await createPiProviderCatalogSnapshot(projectPath)
        return snapshot.providers
          .map((provider) =>
            toCapabilities({
              ...provider,
              oauthProviders: snapshot.oauthProviders,
              oauthProviderNames: snapshot.oauthProviderNames,
              credentials: snapshot.credentials,
              configuredAuthProviders: snapshot.configuredAuthProviders,
              builtInModelProviders: snapshot.builtInModelProviders,
            }),
          )
          .find((provider) => provider.id === providerId)
      }),

    getAll: (projectPath) =>
      Effect.promise(async () => {
        const snapshot = await createPiProviderCatalogSnapshot(projectPath)
        return snapshot.providers.map((provider) =>
          toCapabilities({
            ...provider,
            oauthProviders: snapshot.oauthProviders,
            oauthProviderNames: snapshot.oauthProviderNames,
            credentials: snapshot.credentials,
            configuredAuthProviders: snapshot.configuredAuthProviders,
            builtInModelProviders: snapshot.builtInModelProviders,
          }),
        )
      }),

    getProviderForModel: (modelId, projectPath) =>
      Effect.promise(async () => {
        const snapshot = await createPiProviderCatalogSnapshot(projectPath)
        const provider = snapshot.providers.find((candidate) =>
          candidate.models.some((model) => model.ref === modelId),
        )
        return provider
          ? toCapabilities({
              ...provider,
              oauthProviders: snapshot.oauthProviders,
              oauthProviderNames: snapshot.oauthProviderNames,
              credentials: snapshot.credentials,
              configuredAuthProviders: snapshot.configuredAuthProviders,
              builtInModelProviders: snapshot.builtInModelProviders,
            })
          : undefined
      }).pipe(
        Effect.flatMap((provider) =>
          provider ? Effect.succeed(provider) : Effect.fail(new ProviderLookupError({ modelId })),
        ),
      ),

    isKnownModel: (modelId, projectPath) =>
      Effect.promise(async () => {
        const snapshot = await createPiProviderCatalogSnapshot(projectPath)
        return snapshot.providers.some((provider) =>
          provider.models.some((model) => model.ref === modelId),
        )
      }),
  }),
)
