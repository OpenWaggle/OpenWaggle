import { randomUUID } from 'node:crypto'
import type { AgentSessionServices } from '@earendil-works/pi-coding-agent'
import * as Effect from 'effect/Effect'
import { createFilesystemMcpConfigService } from './adapters/mcp/service-factory'
import {
  getRuntimeEnabledPackagesPiResourceRoots,
  listRuntimeEnabledPackages,
  type OpenWagglePiExtensionSelectionServices,
} from './adapters/pi/openwaggle-pi-extension-selection'
import { recordRuntimeLoadFailure } from './adapters/pi/openwaggle-pi-runtime-failure-recording'
import { createPiRuntimeServices } from './adapters/pi/pi-provider-catalog'
import {
  getPiRuntimeExtensionLoadErrors,
  rejectMatchingOpenWaggleExtensionLoadErrors,
} from './adapters/pi/pi-runtime-extension-load-errors'
import type { AgentDefinitionSemanticCatalog } from './agents/agent-definition-semantic-validation'
import { loadWithRuntimeFailureIsolation } from './extensions/runtime-load-isolation'
import { createLogger } from './logger'
import { ExtensionLifecycleRepository } from './ports/extension-lifecycle-repository'
import { ExtensionManagerService } from './ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from './ports/extension-project-overrides-repository'

const BUILTIN_AND_NATIVE_TOOL_NAMES = [
  'read',
  'bash',
  'powershell',
  'edit',
  'write',
  'grep',
  'find',
  'ls',
  'sessions',
  'mcp',
  'mcp_run',
] as const

export interface LoadAgentDefinitionSemanticCatalogInput {
  readonly projectPath: string
  readonly userHome: string
  readonly extensionSelectionServices?: OpenWagglePiExtensionSelectionServices
}

const logger = createLogger('agent-definition-semantic-catalog')

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function loadDefaultExtensionSelectionServices() {
  const { runAppEffect } = await import('./runtime')
  return runAppEffect(
    Effect.gen(function* () {
      return {
        manager: yield* ExtensionManagerService,
        lifecycleRepository: yield* ExtensionLifecycleRepository,
        projectOverridesRepository: yield* ExtensionProjectOverridesRepository,
      } satisfies OpenWagglePiExtensionSelectionServices
    }),
  )
}

async function loadPiProjectServices(
  projectPath: string,
  extensionSelectionServices: OpenWagglePiExtensionSelectionServices,
): Promise<AgentSessionServices> {
  const enabledPackages = await Effect.runPromise(
    listRuntimeEnabledPackages(projectPath, extensionSelectionServices).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          logger.warn('Failed to resolve OpenWaggle extension runtime allowlist', {
            projectPath,
            error: message(error),
          })
          return []
        }),
      ),
    ),
  )

  return loadWithRuntimeFailureIsolation({
    selections: enabledPackages,
    load: async (enabledOpenWaggleExtensionPackagePaths) => {
      const services = await createPiRuntimeServices(projectPath, {
        enabledOpenWaggleExtensionPackagePaths,
        enabledOpenWaggleExtensionResourceRoots: getRuntimeEnabledPackagesPiResourceRoots(
          enabledPackages,
          enabledOpenWaggleExtensionPackagePaths,
        ),
      })
      return rejectMatchingOpenWaggleExtensionLoadErrors({
        result: services,
        errors: getPiRuntimeExtensionLoadErrors(services),
        enabledOpenWaggleExtensionPackagePaths,
      })
    },
    recordFailure: (selection, error) =>
      recordRuntimeLoadFailure({
        selection,
        error,
        extensionSelectionServices,
        logger,
        operation: 'Agent definition semantic catalog',
      }),
  })
}

export async function loadAgentDefinitionSemanticCatalog(
  input: LoadAgentDefinitionSemanticCatalogInput,
): Promise<AgentDefinitionSemanticCatalog> {
  const loadDiagnostics: string[] = []
  let models: readonly string[] | undefined
  let tools: readonly string[] | undefined
  let skills: readonly string[] | undefined
  let mcpServers: readonly string[] | undefined

  try {
    const extensionSelectionServices =
      input.extensionSelectionServices ?? (await loadDefaultExtensionSelectionServices())
    const services = await loadPiProjectServices(input.projectPath, extensionSelectionServices)
    models = services.modelRuntime.getModels().map((model) => `${model.provider}/${model.id}`)
    skills = services.resourceLoader.getSkills().skills.map((skill) => skill.name)
    const extensionTools = services.resourceLoader
      .getExtensions()
      .extensions.flatMap((extension) => [...extension.tools.keys()])
    tools = [...BUILTIN_AND_NATIVE_TOOL_NAMES, ...extensionTools]
  } catch (error) {
    loadDiagnostics.push(`Pi project resources failed to load: ${message(error)}`)
  }

  try {
    const service = createFilesystemMcpConfigService({
      homeDir: input.userHome,
      createId: randomUUID,
    })
    const view = await service.getView({ projectPath: input.projectPath })
    mcpServers = view.servers.flatMap((server) => [server.name, server.instanceId])
  } catch (error) {
    loadDiagnostics.push(`MCP project resources failed to load: ${message(error)}`)
  }

  return {
    ...(models ? { models } : {}),
    ...(tools ? { tools } : {}),
    ...(skills ? { skills } : {}),
    ...(mcpServers ? { mcpServers } : {}),
    ...(loadDiagnostics.length > 0 ? { loadDiagnostics } : {}),
  }
}
