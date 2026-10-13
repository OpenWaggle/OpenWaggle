import type { ProviderApiKeyAuthSource, ProviderAuthSource } from '@shared/types/llm'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { ProviderLookupError } from '../../errors'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import { type ProviderModelCapabilities, ProviderService } from '../../ports/provider-service'
import type { OpenWagglePiExtensionSelectionServices } from './openwaggle-pi-extension-selection'
import { loadWithProjectExtensions } from './pi-project-runtime-load'
import { createPiProviderCatalogSnapshot } from './pi-provider-catalog'

function toDisplayName(id: string) {
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
  readonly virtual?: boolean
}) {
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
    ...(model.virtual ? { virtual: true } : {}),
  }
}

function getPiProviderDisplayName(providerId: string, providerNames: ReadonlyMap<string, string>) {
  return providerNames.get(providerId) ?? toDisplayName(providerId)
}

export function supportsPiApiKeyAuthProvider(
  providerId: string,
  apiKeySource: ProviderApiKeyAuthSource,
  apiKeyProviders: ReadonlySet<string>,
): boolean {
  return apiKeySource !== 'none' || apiKeyProviders.has(providerId)
}

function toCapabilities(provider: {
  readonly provider: string
  readonly models: readonly Parameters<typeof toModelCapabilities>[0][]
  readonly providerNames: ReadonlyMap<string, string>
  readonly apiKeyProviders: ReadonlySet<string>
  readonly oauthProviders: ReadonlySet<string>
  readonly credentials: ReadonlyMap<string, { readonly type: string }>
  readonly configuredAuthProviders: ReadonlySet<string>
}) {
  const credential = provider.credentials.get(provider.provider)
  const hasConfiguredAuth = provider.configuredAuthProviders.has(provider.provider)
  const source = getProviderAuthSource(credential?.type, hasConfiguredAuth)
  const apiKeySource = getProviderApiKeyAuthSource(credential?.type, hasConfiguredAuth)
  return {
    id: provider.provider,
    displayName: getPiProviderDisplayName(provider.provider, provider.providerNames),
    auth: {
      configured: source !== 'none',
      source,
      apiKeyConfigured: apiKeySource !== 'none',
      apiKeySource,
      oauthConnected: credential?.type === 'oauth',
      supportsApiKey: supportsPiApiKeyAuthProvider(
        provider.provider,
        apiKeySource,
        provider.apiKeyProviders,
      ),
      supportsOAuth: provider.oauthProviders.has(provider.provider),
    },
    models: provider.models.map(toModelCapabilities),
    testModel: provider.models[0]?.id ?? '',
  }
}

function getProviderAuthSource(
  credentialType: string | undefined,
  hasConfiguredAuth: boolean,
): ProviderAuthSource {
  if (credentialType === 'api_key') return 'api-key'
  if (credentialType === 'oauth') return 'oauth'
  return hasConfiguredAuth ? 'environment-or-custom' : 'none'
}

function getProviderApiKeyAuthSource(
  credentialType: string | undefined,
  hasConfiguredAuth: boolean,
): ProviderApiKeyAuthSource {
  if (credentialType === 'api_key') return 'api-key'
  if (credentialType) return 'none'
  return hasConfiguredAuth ? 'environment-or-custom' : 'none'
}

function createProjectProviderCatalogSnapshot(
  projectPath: string | null | undefined,
  extensionSelectionServices: OpenWagglePiExtensionSelectionServices,
) {
  return loadWithProjectExtensions({
    projectPath,
    extensionSelectionServices,
    operation: 'Pi provider catalog',
    load: (options) => createPiProviderCatalogSnapshot(projectPath, options),
    loadErrors: (snapshot) => snapshot.extensionLoadErrors,
  })
}

export const ProviderServiceLive = Layer.effect(
  ProviderService,
  Effect.gen(function* () {
    const extensionSelectionServices = {
      manager: yield* ExtensionManagerService,
      lifecycleRepository: yield* ExtensionLifecycleRepository,
      projectOverridesRepository: yield* ExtensionProjectOverridesRepository,
    } satisfies OpenWagglePiExtensionSelectionServices

    return ProviderService.of({
      get: (providerId, projectPath) =>
        Effect.gen(function* () {
          const snapshot = yield* createProjectProviderCatalogSnapshot(
            projectPath,
            extensionSelectionServices,
          )
          return snapshot.providers
            .map((provider) =>
              toCapabilities({
                ...provider,
                providerNames: snapshot.providerNames,
                apiKeyProviders: snapshot.apiKeyProviders,
                oauthProviders: snapshot.oauthProviders,
                credentials: snapshot.credentials,
                configuredAuthProviders: snapshot.configuredAuthProviders,
              }),
            )
            .find((provider) => provider.id === providerId)
        }),

      getAll: (projectPath) =>
        Effect.gen(function* () {
          const snapshot = yield* createProjectProviderCatalogSnapshot(
            projectPath,
            extensionSelectionServices,
          )
          return snapshot.providers.map((provider) =>
            toCapabilities({
              ...provider,
              providerNames: snapshot.providerNames,
              apiKeyProviders: snapshot.apiKeyProviders,
              oauthProviders: snapshot.oauthProviders,
              credentials: snapshot.credentials,
              configuredAuthProviders: snapshot.configuredAuthProviders,
            }),
          )
        }),

      getProviderForModel: (modelId, projectPath) =>
        Effect.gen(function* () {
          const snapshot = yield* createProjectProviderCatalogSnapshot(
            projectPath,
            extensionSelectionServices,
          )
          const provider = snapshot.providers.find((candidate) =>
            candidate.models.some((model) => model.ref === modelId),
          )
          return provider
            ? toCapabilities({
                ...provider,
                providerNames: snapshot.providerNames,
                apiKeyProviders: snapshot.apiKeyProviders,
                oauthProviders: snapshot.oauthProviders,
                credentials: snapshot.credentials,
                configuredAuthProviders: snapshot.configuredAuthProviders,
              })
            : undefined
        }).pipe(
          Effect.flatMap((provider) =>
            provider ? Effect.succeed(provider) : Effect.fail(new ProviderLookupError({ modelId })),
          ),
        ),

      isKnownModel: (modelId, projectPath) =>
        Effect.gen(function* () {
          const snapshot = yield* createProjectProviderCatalogSnapshot(
            projectPath,
            extensionSelectionServices,
          )
          return snapshot.providers.some((provider) =>
            provider.models.some((model) => model.ref === modelId),
          )
        }),
    })
  }),
)
