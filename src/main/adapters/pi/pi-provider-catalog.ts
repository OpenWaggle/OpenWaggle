import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  type AgentSessionServices,
  type AuthCredential,
  AuthStorage,
  type CreateAgentSessionServicesOptions,
  createAgentSessionServices,
  getAgentDir,
  ModelRegistry,
  type SettingsManager,
} from '@mariozechner/pi-coding-agent'
import { createModelRef } from '@shared/types/llm'
import { THINKING_LEVELS, type ThinkingLevel } from '@shared/types/settings'
import { isPathInside } from '@shared/utils/paths'
import { normalizeSkillId } from '@shared/utils/skill-id'
import { createOpenWagglePiSettingsManager } from './openwaggle-pi-settings-storage'

export interface ProviderModelRecord {
  readonly ref: string
  readonly provider: string
  readonly id: string
  readonly name: string
  readonly available: boolean
  readonly reasoning: boolean
  readonly availableThinkingLevels: readonly ThinkingLevel[]
  readonly input: readonly ('text' | 'image')[]
  readonly contextWindow: number
  readonly maxTokens: number
  readonly api: string
}

export interface ProviderCatalogRecord {
  readonly provider: string
  readonly models: readonly ProviderModelRecord[]
}

export interface ProviderCatalogSnapshot {
  readonly providers: readonly ProviderCatalogRecord[]
  readonly oauthProviders: ReadonlySet<string>
  readonly oauthProviderNames: ReadonlyMap<string, string>
  readonly credentials: ReadonlyMap<string, AuthCredential>
  readonly configuredAuthProviders: ReadonlySet<string>
  readonly builtInModelProviders: ReadonlySet<string>
}

export type PiModel = NonNullable<ReturnType<ModelRegistry['find']>>

interface PiModelRuntime {
  readonly model: PiModel
  readonly authStorage: AuthStorage
  readonly modelRegistry: ModelRegistry
}

interface PiRuntimeServicesOptions {
  readonly skillToggles?: Readonly<Record<string, boolean>>
}

export interface PiProjectModelRuntime extends PiModelRuntime {
  readonly services: AgentSessionServices
}

let sharedAuthStorage: AuthStorage | null = null
let sharedModelRegistry: ModelRegistry | null = null
let builtInModelProviders: ReadonlySet<string> | null = null

const OPENWAGGLE_SKILLS_ROOT_SEGMENTS = ['.openwaggle', 'skills'] as const
const OPENWAGGLE_EXTENSIONS_ROOT_SEGMENTS = ['.openwaggle', 'extensions'] as const
const OPENWAGGLE_PROMPTS_ROOT_SEGMENTS = ['.openwaggle', 'prompts'] as const
const OPENWAGGLE_THEMES_ROOT_SEGMENTS = ['.openwaggle', 'themes'] as const
const OPENWAGGLE_CATALOG_SKILL_ROOT_SEGMENTS = [
  OPENWAGGLE_SKILLS_ROOT_SEGMENTS,
  ['.agents', 'skills'] as const,
] as const
const PI_THINKING_LEVELS_WITHOUT_XHIGH: readonly ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
]
const PI_OFF_THINKING_LEVELS: readonly ThinkingLevel[] = ['off']

type PiResourceLoaderOptions = NonNullable<
  CreateAgentSessionServicesOptions['resourceLoaderOptions']
>
type PiSkillsOverride = NonNullable<PiResourceLoaderOptions['skillsOverride']>
type PiSkillsOverrideInput = Parameters<PiSkillsOverride>[0]

export function getPiAgentDir(): string {
  return getAgentDir()
}

function getSharedAuthStorage(): AuthStorage {
  if (sharedAuthStorage) {
    return sharedAuthStorage
  }
  sharedAuthStorage = AuthStorage.create()
  return sharedAuthStorage
}

function getSharedModelRegistry(): ModelRegistry {
  if (sharedModelRegistry) {
    return sharedModelRegistry
  }
  sharedModelRegistry = ModelRegistry.create(getSharedAuthStorage())
  return sharedModelRegistry
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

export function reloadPiProviderCatalog(): void {
  sharedAuthStorage?.reload()
  sharedModelRegistry?.refresh()
}

function piModelSupportsXhighThinking(modelId: string): boolean {
  return (
    modelId.includes('gpt-5.2') ||
    modelId.includes('gpt-5.3') ||
    modelId.includes('gpt-5.4') ||
    modelId.includes('gpt-5.5') ||
    modelId.includes('opus-4-6') ||
    modelId.includes('opus-4.6') ||
    modelId.includes('opus-4-7') ||
    modelId.includes('opus-4.7')
  )
}

export function getPiModelAvailableThinkingLevels(model: {
  readonly id: string
  readonly reasoning: boolean
}): readonly ThinkingLevel[] {
  if (!model.reasoning) {
    return PI_OFF_THINKING_LEVELS
  }

  return piModelSupportsXhighThinking(model.id) ? THINKING_LEVELS : PI_THINKING_LEVELS_WITHOUT_XHIGH
}

function listPiProviderModelsFromRegistry(
  modelRegistry: ModelRegistry,
): readonly ProviderModelRecord[] {
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

function listPiProvidersFromModels(
  models: readonly ProviderModelRecord[],
): readonly ProviderCatalogRecord[] {
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

function buildAuthCredentialMap(authStorage: AuthStorage): ReadonlyMap<string, AuthCredential> {
  const credentials = new Map<string, AuthCredential>()
  for (const provider of authStorage.list()) {
    const credential = authStorage.get(provider)
    if (credential) {
      credentials.set(provider, credential)
    }
  }
  return credentials
}

function buildConfiguredAuthProviderSet(modelRegistry: ModelRegistry): ReadonlySet<string> {
  return new Set(modelRegistry.getAvailable().map((model) => model.provider))
}

function buildOAuthProviderSet(authStorage: AuthStorage): ReadonlySet<string> {
  return new Set(authStorage.getOAuthProviders().map((provider) => provider.id))
}

function buildOAuthProviderNameMap(authStorage: AuthStorage): ReadonlyMap<string, string> {
  return new Map(authStorage.getOAuthProviders().map((provider) => [provider.id, provider.name]))
}

function getOpenWaggleSkillsRoot(projectPath: string): string {
  return path.join(projectPath, ...OPENWAGGLE_SKILLS_ROOT_SEGMENTS)
}

function getOpenWaggleExtensionsRoot(projectPath: string): string {
  return path.join(projectPath, ...OPENWAGGLE_EXTENSIONS_ROOT_SEGMENTS)
}

function getOpenWagglePromptsRoot(projectPath: string): string {
  return path.join(projectPath, ...OPENWAGGLE_PROMPTS_ROOT_SEGMENTS)
}

function getOpenWaggleThemesRoot(projectPath: string): string {
  return path.join(projectPath, ...OPENWAGGLE_THEMES_ROOT_SEGMENTS)
}

function includeExistingPath(filePath: string): string[] {
  return existsSync(filePath) ? [filePath] : []
}

function getOpenWaggleCatalogSkillRoots(projectPath: string): readonly string[] {
  return OPENWAGGLE_CATALOG_SKILL_ROOT_SEGMENTS.map((segments) =>
    path.join(projectPath, ...segments),
  )
}

function getCatalogSkillIdForPiSkill(projectPath: string, skillFilePath: string): string | null {
  const resolvedSkillFilePath = path.resolve(skillFilePath)
  for (const skillRoot of getOpenWaggleCatalogSkillRoots(projectPath)) {
    const resolvedSkillRoot = path.resolve(skillRoot)
    if (!isPathInside(resolvedSkillRoot, resolvedSkillFilePath)) {
      continue
    }

    const relativePath = path.relative(resolvedSkillRoot, resolvedSkillFilePath)
    const [skillRootSegment] = relativePath.split(path.sep)
    if (!skillRootSegment) {
      return null
    }

    return normalizeSkillId(path.basename(skillRootSegment, path.extname(skillRootSegment)))
  }

  return null
}

function filterDisabledCatalogSkills(
  projectPath: string,
  skillToggles: Readonly<Record<string, boolean>>,
  base: PiSkillsOverrideInput,
): PiSkillsOverrideInput {
  return {
    skills: base.skills.filter((skill) => {
      const skillId = getCatalogSkillIdForPiSkill(projectPath, skill.filePath)
      return skillId === null || skillToggles[skillId] !== false
    }),
    diagnostics: base.diagnostics,
  }
}

export function createOpenWagglePiResourceLoaderOptions(
  projectPath: string,
  options: PiRuntimeServicesOptions = {},
  settingsManager?: SettingsManager,
): PiResourceLoaderOptions {
  const skillToggles = options.skillToggles ?? {}
  return {
    additionalExtensionPaths: settingsManager
      ? []
      : includeExistingPath(getOpenWaggleExtensionsRoot(projectPath)),
    additionalSkillPaths: settingsManager
      ? []
      : includeExistingPath(getOpenWaggleSkillsRoot(projectPath)),
    additionalPromptTemplatePaths: settingsManager
      ? []
      : includeExistingPath(getOpenWagglePromptsRoot(projectPath)),
    additionalThemePaths: settingsManager
      ? []
      : includeExistingPath(getOpenWaggleThemesRoot(projectPath)),
    skillsOverride: (base) => filterDisabledCatalogSkills(projectPath, skillToggles, base),
  }
}

function createPiProviderCatalogSnapshotFromRuntime(
  modelRegistry: ModelRegistry,
  authStorage: AuthStorage,
): ProviderCatalogSnapshot {
  return {
    providers: listPiProvidersFromModels(listPiProviderModelsFromRegistry(modelRegistry)),
    oauthProviders: buildOAuthProviderSet(authStorage),
    oauthProviderNames: buildOAuthProviderNameMap(authStorage),
    credentials: buildAuthCredentialMap(authStorage),
    configuredAuthProviders: buildConfiguredAuthProviderSet(modelRegistry),
    builtInModelProviders: getBuiltInPiModelProviderIds(),
  }
}

export async function createPiRuntimeServices(
  projectPath: string,
  options: PiRuntimeServicesOptions = {},
): Promise<AgentSessionServices> {
  const authStorage = createPiRuntimeAuthStorage()
  const settingsManager = createOpenWagglePiSettingsManager(projectPath)
  return createAgentSessionServices({
    cwd: projectPath,
    agentDir: getPiAgentDir(),
    authStorage,
    settingsManager,
    resourceLoaderOptions: createOpenWagglePiResourceLoaderOptions(
      projectPath,
      options,
      settingsManager,
    ),
  })
}

export async function createPiProviderCatalogSnapshot(
  projectPath?: string | null,
): Promise<ProviderCatalogSnapshot> {
  const normalizedProjectPath = projectPath?.trim()
  if (!normalizedProjectPath) {
    return createPiProviderCatalogSnapshotFromRuntime(
      getSharedModelRegistry(),
      getSharedAuthStorage(),
    )
  }

  const services = await createPiRuntimeServices(normalizedProjectPath)
  return createPiProviderCatalogSnapshotFromRuntime(services.modelRegistry, services.authStorage)
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
  reloadPiProviderCatalog()
}

export function createPiRuntimeAuthStorage(): AuthStorage {
  return AuthStorage.create()
}

function findExplicitProviderModelReference(
  modelRegistry: ModelRegistry,
  modelReference: string,
): PiModel | null {
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
}): Promise<PiProjectModelRuntime> {
  const services = await createPiRuntimeServices(
    input.projectPath,
    input.skillToggles ? { skillToggles: input.skillToggles } : {},
  )
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
