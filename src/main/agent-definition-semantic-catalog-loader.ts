import { homedir } from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { listConfiguredMcpServerNames } from './adapters/mcp/config/mcp-server-names'
import { readLegacyMcpServerNames } from './adapters/mcp/migration/legacy-server-names'
import { loadAgentDefinitionPiProjectServices } from './adapters/pi/agent-definition-semantic-catalog-services'
import { migrateOpenWaggleMcpFilesOnce } from './adapters/pi/mcp/openwaggle-mcp-migration'
import type { OpenWagglePiExtensionSelectionServices } from './adapters/pi/openwaggle-pi-extension-selection'
import type { AgentDefinitionSemanticCatalog } from './agents/agent-definition-semantic-validation'
import { MCP_REACH_TOOL_NAMES } from './domain/agents/agent-tool-allowlist'
import { legacyMcpServerAliases } from './domain/mcp/migration/legacy-server-references'
import { getEnvWithOverrides } from './env'
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
] as const

export interface LoadAgentDefinitionSemanticCatalogInput {
  readonly projectPath: string
  readonly userHome: string
  /** Pi's agent directory; defaults to `PI_CODING_AGENT_DIR` for the real home, else `~/.pi/agent`. */
  readonly piAgentDir?: string
  readonly extensionSelectionServices?: OpenWagglePiExtensionSelectionServices
}

function piAgentDirFor(input: LoadAgentDefinitionSemanticCatalogInput) {
  if (input.piAgentDir) return input.piAgentDir
  const configured =
    input.userHome === homedir() ? getEnvWithOverrides({}).PI_CODING_AGENT_DIR : undefined
  return configured ?? path.join(input.userHome, '.pi', 'agent')
}

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
    const services = await loadAgentDefinitionPiProjectServices(
      input.projectPath,
      extensionSelectionServices,
    )
    models = services.modelRuntime.getModels().map((model) => `${model.provider}/${model.id}`)
    skills = services.resourceLoader.getSkills().skills.map((skill) => skill.name)
    const extensionTools = services.resourceLoader
      .getExtensions()
      .extensions.flatMap((extension) => [...extension.tools.keys()])
    // Pi's codemode, tool search, and MCP resource tools load in every Session (ADR 0048).
    tools = [...BUILTIN_AND_NATIVE_TOOL_NAMES, ...MCP_REACH_TOOL_NAMES, ...extensionTools]
  } catch (error) {
    loadDiagnostics.push(`Pi project resources failed to load: ${message(error)}`)
  }

  try {
    // The names must be the migrated ones, as Settings and Runs see them.
    await migrateOpenWaggleMcpFilesOnce(input.projectPath)
    const configured = await listConfiguredMcpServerNames({
      homeDir: input.userHome,
      piAgentDir: piAgentDirFor(input),
      projectPath: input.projectPath,
    })
    // An unreadable file leaves the list incomplete; checking names against it would misreport.
    if (configured.errors.length === 0) {
      // A definition from before ADR 0048 may name a server by its old instance ID.
      const legacyNames = await readLegacyMcpServerNames(input.userHome)
      mcpServers = [...configured.names, ...legacyMcpServerAliases(configured.names, legacyNames)]
    } else loadDiagnostics.push(...configured.errors)
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
