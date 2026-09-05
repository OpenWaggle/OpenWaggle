import type { CredentialInfo } from '@earendil-works/pi-ai'
import {
  type AgentSessionServices,
  createAgentSessionServices,
  type ExtensionFactory,
  getAgentDir,
  ModelRuntime,
} from '@earendil-works/pi-coding-agent'
import { createModelRef } from '@shared/types/llm'
import { withNpmCompatibleProcessEnv } from '../../env'
import { createLogger } from '../../logger'
import { LEGACY_PI_MCP_ADAPTER_PACKAGE_SOURCES } from '../../migrations/legacy-pi-mcp-adapter'
import { OPENWAGGLE_EXCLUDED_PI_NPM_PACKAGE_NAMES } from './openwaggle-pi-package-policy'
import {
  createOpenWaggleGlobalPiSettingsManager,
  createOpenWagglePiSettingsManager,
} from './openwaggle-pi-settings-storage'
import {
  createOpenWaggleGlobalPiResourceLoaderOptions,
  createOpenWagglePiResourceLoaderOptions,
  type PiRuntimeServicesOptions,
} from './pi-provider-resources'
import { getPiModelAvailableThinkingLevels } from './pi-provider-thinking'
import { getPiRuntimeExtensionLoadErrors } from './pi-runtime-extension-load-errors'
import { ensurePiVisualizeSkill } from './pi-visualize-skill'

export { getPiModelAvailableThinkingLevels } from './pi-provider-thinking'

const logger = createLogger('pi-provider-catalog')

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

export function getPiAgentDir(): string {
  return getAgentDir()
}

export async function resolvePiVisualizeSkillPaths(
  agentDir: string,
  install = ensurePiVisualizeSkill,
) {
  try {
    return [await install(agentDir)]
  } catch (error) {
    logger.warn('Visualize skill installation failed; continuing without built-in authoring', {
      agentDir,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

function listPiProviderModelsFromRuntime(modelRuntime: ModelRuntime) {
  const availableRefs = new Set(
    modelRuntime.getAvailableSnapshot().map((model) => createModelRef(model.provider, model.id)),
  )

  return modelRuntime.getModels().map((model) => ({
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

async function buildAuthCredentialMap(modelRuntime: ModelRuntime) {
  const credentials = new Map<string, CredentialInfo>()
  for (const credential of await modelRuntime.listCredentials()) {
    credentials.set(credential.providerId, credential)
  }
  return credentials
}

function buildConfiguredAuthProviderSet(modelRuntime: ModelRuntime) {
  const providers = new Set<string>()
  for (const provider of modelRuntime.getProviders()) {
    if (modelRuntime.getProviderAuthStatus(provider.id).configured) {
      providers.add(provider.id)
    }
  }
  return providers
}

function buildOAuthProviderSet(modelRuntime: ModelRuntime) {
  const providers = new Set<string>()
  for (const provider of modelRuntime.getProviders()) {
    if (provider.auth.oauth !== undefined) {
      providers.add(provider.id)
    }
  }
  return providers
}

function buildApiKeyProviderSet(modelRuntime: ModelRuntime) {
  const providers = new Set<string>()
  for (const provider of modelRuntime.getProviders()) {
    if (provider.auth.apiKey !== undefined) {
      providers.add(provider.id)
    }
  }
  return providers
}

function buildProviderNameMap(modelRuntime: ModelRuntime) {
  return new Map(modelRuntime.getProviders().map((provider) => [provider.id, provider.name]))
}

async function createPiProviderCatalogSnapshotFromRuntime(services: AgentSessionServices) {
  const { modelRuntime } = services
  return {
    providers: listPiProvidersFromModels(listPiProviderModelsFromRuntime(modelRuntime)),
    providerNames: buildProviderNameMap(modelRuntime),
    apiKeyProviders: buildApiKeyProviderSet(modelRuntime),
    oauthProviders: buildOAuthProviderSet(modelRuntime),
    credentials: await buildAuthCredentialMap(modelRuntime),
    configuredAuthProviders: buildConfiguredAuthProviderSet(modelRuntime),
    extensionLoadErrors: getPiRuntimeExtensionLoadErrors(services),
  }
}

export async function createPiRuntimeServices(
  projectPath: string,
  options: PiRuntimeServicesOptions = {},
): Promise<AgentSessionServices> {
  const agentDir = getPiAgentDir()
  const visualizeSkillPaths = await resolvePiVisualizeSkillPaths(agentDir)
  const settingsManager = createOpenWagglePiSettingsManager(projectPath, {
    ...(options.compactionThresholdPercent !== undefined
      ? { compactionThresholdPercent: options.compactionThresholdPercent }
      : {}),
    enabledOpenWaggleExtensionPackagePaths: options.enabledOpenWaggleExtensionPackagePaths ?? [],
    enabledOpenWaggleExtensionResourceRoots: options.enabledOpenWaggleExtensionResourceRoots ?? [],
    excludedGlobalPackageSources: LEGACY_PI_MCP_ADAPTER_PACKAGE_SOURCES,
    excludedProjectPackageSources: LEGACY_PI_MCP_ADAPTER_PACKAGE_SOURCES,
    runtimeExcludedNpmPackageNames: OPENWAGGLE_EXCLUDED_PI_NPM_PACKAGE_NAMES,
  })
  const services = await withNpmCompatibleProcessEnv(() =>
    createAgentSessionServices({
      cwd: projectPath,
      agentDir,
      settingsManager,
      resourceLoaderOptions: createOpenWagglePiResourceLoaderOptions(
        projectPath,
        options,
        settingsManager,
        visualizeSkillPaths,
      ),
    }),
  )
  return services
}

async function createPiGlobalProviderCatalogServices() {
  const agentDir = getPiAgentDir()
  const settingsManager = createOpenWaggleGlobalPiSettingsManager({
    excludedGlobalPackageSources: LEGACY_PI_MCP_ADAPTER_PACKAGE_SOURCES,
    runtimeExcludedNpmPackageNames: OPENWAGGLE_EXCLUDED_PI_NPM_PACKAGE_NAMES,
  })
  const services = await withNpmCompatibleProcessEnv(() =>
    createAgentSessionServices({
      cwd: agentDir,
      agentDir,
      settingsManager,
      resourceLoaderOptions: createOpenWaggleGlobalPiResourceLoaderOptions(),
    }),
  )
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
    return await createPiProviderCatalogSnapshotFromRuntime(services)
  }

  const services = await createPiRuntimeServices(normalizedProjectPath, {
    enabledOpenWaggleExtensionPackagePaths: options.enabledOpenWaggleExtensionPackagePaths ?? [],
    enabledOpenWaggleExtensionResourceRoots: options.enabledOpenWaggleExtensionResourceRoots ?? [],
  })
  return await createPiProviderCatalogSnapshotFromRuntime(services)
}

export async function setPiProviderApiKey(providerId: string, apiKey: string) {
  const provider = providerId.trim()
  if (!provider) {
    throw new Error('Provider is required')
  }

  const modelRuntime = await ModelRuntime.create()
  const trimmedKey = apiKey.trim()
  if (trimmedKey) {
    await modelRuntime.login(provider, 'api_key', {
      notify() {},
      prompt: async () => trimmedKey,
    })
    return
  }

  await modelRuntime.logout(provider)
}

function findExplicitProviderModelReference(modelRuntime: ModelRuntime, modelReference: string) {
  const separatorIndex = modelReference.indexOf('/')
  if (separatorIndex <= 0 || separatorIndex === modelReference.length - 1) {
    return null
  }

  const provider = modelReference.slice(0, separatorIndex)
  const modelId = modelReference.slice(separatorIndex + 1)
  return modelRuntime.getModel(provider, modelId) ?? null
}

export function findPiToolCapableModel(
  modelRuntime: ModelRuntime,
  modelReference: string,
): PiModel | null {
  const trimmedReference = modelReference.trim()
  if (!trimmedReference) {
    return null
  }

  return findExplicitProviderModelReference(modelRuntime, trimmedReference)
}

export async function createPiProjectModelRuntime(input: {
  readonly projectPath: string
  readonly modelReference: string
  readonly compactionThresholdPercent?: number
  readonly skillToggles?: Readonly<Record<string, boolean>>
  readonly enabledOpenWaggleExtensionPackagePaths?: readonly string[]
  readonly enabledOpenWaggleExtensionResourceRoots?: PiRuntimeServicesOptions['enabledOpenWaggleExtensionResourceRoots']
  readonly extensionFactories?: readonly ExtensionFactory[]
  readonly visualizationDirectory?: string
}): Promise<PiProjectModelRuntime> {
  const services = await createPiRuntimeServices(input.projectPath, {
    ...(input.compactionThresholdPercent !== undefined
      ? { compactionThresholdPercent: input.compactionThresholdPercent }
      : {}),
    ...(input.skillToggles ? { skillToggles: input.skillToggles } : {}),
    ...(input.enabledOpenWaggleExtensionPackagePaths
      ? { enabledOpenWaggleExtensionPackagePaths: input.enabledOpenWaggleExtensionPackagePaths }
      : {}),
    ...(input.enabledOpenWaggleExtensionResourceRoots
      ? { enabledOpenWaggleExtensionResourceRoots: input.enabledOpenWaggleExtensionResourceRoots }
      : {}),
    ...(input.extensionFactories ? { extensionFactories: input.extensionFactories } : {}),
    ...(input.visualizationDirectory
      ? { visualizationDirectory: input.visualizationDirectory }
      : {}),
  })
  const model = findPiToolCapableModel(services.modelRuntime, input.modelReference)
  if (!model) {
    throw new Error(`Pi model registry could not resolve model ${input.modelReference}`)
  }

  return {
    model,
    services,
  }
}
