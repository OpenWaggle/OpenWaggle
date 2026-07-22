import {
  type AgentSessionServices,
  type AuthCredential,
  AuthStorage,
  createAgentSessionServices,
  type ExtensionFactory,
  getAgentDir,
  ModelRegistry,
} from '@earendil-works/pi-coding-agent'
import { MCP_ADAPTER_PACKAGE_SOURCES } from '@shared/constants/mcp'
import { createModelRef } from '@shared/types/llm'
import { withNpmCompatibleProcessEnv } from '../../env'
import {
  createOpenWaggleGlobalPiSettingsManager,
  createOpenWagglePiSettingsManager,
} from './openwaggle-pi-settings-storage'
import {
  prepareOpenWaggleMcpRuntimeContext,
  rememberOpenWaggleMcpRuntimeContext,
  withOpenWaggleMcpAdapterProcessContext,
} from './pi-mcp-config-service'
import {
  createOpenWagglePiResourceLoaderOptions,
  type PiRuntimeServicesOptions,
} from './pi-provider-resources'
import { getPiModelAvailableThinkingLevels } from './pi-provider-thinking'
import { getPiRuntimeExtensionLoadErrors } from './pi-runtime-extension-load-errors'

export { getPiModelAvailableThinkingLevels } from './pi-provider-thinking'

import type {
  PiModel,
  PiProjectModelRuntime,
  ProviderCatalogSnapshot,
  ProviderModelRecord,
} from './pi-provider-catalog-types'

export type {
  PiModel,
  PiProjectModelRuntime,
  ProviderCatalogRecord,
  ProviderCatalogSnapshot,
  ProviderModelRecord,
} from './pi-provider-catalog-types'

let builtInModelProviders: ReadonlySet<string> | null = null

export function getPiAgentDir(): string {
  return getAgentDir()
}

export function getBuiltInPiModelProviderIds(): ReadonlySet<string> {
  if (builtInModelProviders) {
    return builtInModelProviders
  }

  const authStorage = AuthStorage.inMemory()
  const modelRegistry = ModelRegistry.inMemory(authStorage)
  builtInModelProviders = new Set(modelRegistry.getAll().map((model) => model.provider))
  return builtInModelProviders
}

function listPiProviderModelsFromRegistry(modelRegistry: ModelRegistry) {
  const availableRefs = new Set(
    modelRegistry.getAvailable().map((model) => createModelRef(model.provider, model.id)),
  )

  return modelRegistry.getAll().map((model) => ({
    ref: createModelRef(model.provider, model.id),
    provider: model.provider,
    id: model.id,
    name: model.name,
    available: availableRefs.has(createModelRef(model.provider, model.id)),
    reasoning: model.reasoning,
    availableThinkingLevels: getPiModelAvailableThinkingLevels(model),
    input: [...model.input],
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    api: model.api,
  }))
}

function listPiProvidersFromModels(models: readonly ProviderModelRecord[]) {
  const modelsByProvider = new Map<string, ProviderModelRecord[]>()

  for (const model of models) {
    const models = modelsByProvider.get(model.provider)
    if (models) {
      models.push(model)
      continue
    }
    modelsByProvider.set(model.provider, [model])
  }

  return [...modelsByProvider.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([provider, models]) => ({
      provider,
      models: [...models].sort((left, right) => left.name.localeCompare(right.name)),
    }))
}

function buildAuthCredentialMap(authStorage: AuthStorage) {
  const credentials = new Map<string, AuthCredential>()
  for (const provider of authStorage.list()) {
    const credential = authStorage.get(provider)
    if (credential) {
      credentials.set(provider, credential)
    }
  }
  return credentials
}

function buildConfiguredAuthProviderSet(modelRegistry: ModelRegistry) {
  return new Set(modelRegistry.getAvailable().map((model) => model.provider))
}

function buildOAuthProviderSet(authStorage: AuthStorage) {
  return new Set(authStorage.getOAuthProviders().map((provider) => provider.id))
}

function buildOAuthProviderNameMap(authStorage: AuthStorage) {
  return new Map(authStorage.getOAuthProviders().map((provider) => [provider.id, provider.name]))
}

function createPiProviderCatalogSnapshotFromRuntime(
  services: Pick<AgentSessionServices, 'modelRegistry' | 'authStorage' | 'resourceLoader'>,
) {
  return {
    providers: listPiProvidersFromModels(listPiProviderModelsFromRegistry(services.modelRegistry)),
    oauthProviders: buildOAuthProviderSet(services.authStorage),
    oauthProviderNames: buildOAuthProviderNameMap(services.authStorage),
    credentials: buildAuthCredentialMap(services.authStorage),
    configuredAuthProviders: buildConfiguredAuthProviderSet(services.modelRegistry),
    builtInModelProviders: getBuiltInPiModelProviderIds(),
    extensionLoadErrors: getPiRuntimeExtensionLoadErrors(services),
  }
}

export async function createPiRuntimeServices(
  projectPath: string,
  options: PiRuntimeServicesOptions = {},
): Promise<AgentSessionServices> {
  const authStorage = createPiRuntimeAuthStorage()
  const loadMcpAdapter = options.loadMcpAdapter ?? true
  const settingsManager = createOpenWagglePiSettingsManager(projectPath, {
    enabledOpenWaggleExtensionPackagePaths: options.enabledOpenWaggleExtensionPackagePaths ?? [],
    enabledOpenWaggleExtensionResourceRoots: options.enabledOpenWaggleExtensionResourceRoots ?? [],
    ...(loadMcpAdapter
      ? {}
      : {
          excludedGlobalPackageSources: MCP_ADAPTER_PACKAGE_SOURCES,
          excludedProjectPackageSources: MCP_ADAPTER_PACKAGE_SOURCES,
        }),
  })
  const mcpRuntimeContext = loadMcpAdapter
    ? options.mcpRuntimeContext === undefined
      ? await prepareOpenWaggleMcpRuntimeContext(projectPath)
      : options.mcpRuntimeContext
    : null
  const services = await withNpmCompatibleProcessEnv(() =>
    withOpenWaggleMcpAdapterProcessContext(mcpRuntimeContext, () =>
      createAgentSessionServices({
        cwd: projectPath,
        agentDir: getPiAgentDir(),
        authStorage,
        settingsManager,
        ...(mcpRuntimeContext
          ? {
              extensionFlagValues: new Map<string, boolean | string>([
                ['mcp-config', mcpRuntimeContext.configPath],
              ]),
            }
          : {}),
        resourceLoaderOptions: createOpenWagglePiResourceLoaderOptions(
          projectPath,
          options,
          settingsManager,
        ),
      }),
    ),
  )
  rememberOpenWaggleMcpRuntimeContext(services, mcpRuntimeContext)
  return services
}

async function createPiGlobalProviderCatalogServices() {
  const agentDir = getPiAgentDir()
  const authStorage = createPiRuntimeAuthStorage()
  const settingsManager = createOpenWaggleGlobalPiSettingsManager({
    excludedGlobalPackageSources: MCP_ADAPTER_PACKAGE_SOURCES,
  })
  const services = await withNpmCompatibleProcessEnv(() =>
    createAgentSessionServices({
      cwd: agentDir,
      agentDir,
      authStorage,
      settingsManager,
    }),
  )
  rememberOpenWaggleMcpRuntimeContext(services, null)
  return services
}

export async function createPiProviderCatalogSnapshot(
  projectPath?: string | null,
  options: Pick<
    PiRuntimeServicesOptions,
    'enabledOpenWaggleExtensionPackagePaths' | 'enabledOpenWaggleExtensionResourceRoots'
  > = {},
): Promise<ProviderCatalogSnapshot> {
  const normalizedProjectPath = projectPath?.trim()
  if (!normalizedProjectPath) {
    const services = await createPiGlobalProviderCatalogServices()
    return createPiProviderCatalogSnapshotFromRuntime(services)
  }

  const services = await createPiRuntimeServices(normalizedProjectPath, {
    enabledOpenWaggleExtensionPackagePaths: options.enabledOpenWaggleExtensionPackagePaths ?? [],
    enabledOpenWaggleExtensionResourceRoots: options.enabledOpenWaggleExtensionResourceRoots ?? [],
    loadMcpAdapter: false,
  })
  return createPiProviderCatalogSnapshotFromRuntime(services)
}

export function setPiProviderApiKey(providerId: string, apiKey: string): void {
  const provider = providerId.trim()
  if (!provider) {
    throw new Error('Provider is required')
  }

  const authStorage = AuthStorage.create()
  const trimmedKey = apiKey.trim()
  if (trimmedKey) {
    authStorage.set(provider, { type: 'api_key', key: trimmedKey })
  } else {
    authStorage.remove(provider)
  }
}

export function createPiRuntimeAuthStorage(): AuthStorage {
  return AuthStorage.create()
}

function findExplicitProviderModelReference(modelRegistry: ModelRegistry, modelReference: string) {
  const separatorIndex = modelReference.indexOf('/')
  if (separatorIndex <= 0 || separatorIndex === modelReference.length - 1) {
    return null
  }

  const provider = modelReference.slice(0, separatorIndex)
  const modelId = modelReference.slice(separatorIndex + 1)
  return modelRegistry.find(provider, modelId) ?? null
}

export function findPiModel(modelRegistry: ModelRegistry, modelReference: string): PiModel | null {
  const trimmedReference = modelReference.trim()
  if (!trimmedReference) {
    return null
  }

  return findExplicitProviderModelReference(modelRegistry, trimmedReference)
}

export async function createPiProjectModelRuntime(input: {
  readonly projectPath: string
  readonly modelReference: string
  readonly skillToggles?: Readonly<Record<string, boolean>>
  readonly enabledOpenWaggleExtensionPackagePaths?: readonly string[]
  readonly enabledOpenWaggleExtensionResourceRoots?: PiRuntimeServicesOptions['enabledOpenWaggleExtensionResourceRoots']
  readonly extensionFactories?: readonly ExtensionFactory[]
}): Promise<PiProjectModelRuntime> {
  const services = await createPiRuntimeServices(input.projectPath, {
    ...(input.skillToggles ? { skillToggles: input.skillToggles } : {}),
    ...(input.enabledOpenWaggleExtensionPackagePaths
      ? { enabledOpenWaggleExtensionPackagePaths: input.enabledOpenWaggleExtensionPackagePaths }
      : {}),
    ...(input.enabledOpenWaggleExtensionResourceRoots
      ? { enabledOpenWaggleExtensionResourceRoots: input.enabledOpenWaggleExtensionResourceRoots }
      : {}),
    ...(input.extensionFactories ? { extensionFactories: input.extensionFactories } : {}),
  })
  const model = findPiModel(services.modelRegistry, input.modelReference)
  if (!model) {
    throw new Error(`Pi model registry could not resolve model ${input.modelReference}`)
  }

  return {
    model,
    authStorage: services.authStorage,
    modelRegistry: services.modelRegistry,
    services,
  }
}
