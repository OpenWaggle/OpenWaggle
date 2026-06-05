import type { AgentSessionServices } from '@earendil-works/pi-coding-agent'
import type {
  McpConfigFile,
  McpConfigSourceId,
  McpConfigSourceKind,
  McpConfigSourceScope,
  McpServerMap,
  McpSetServerEnabledInput,
  McpSettingsView,
  McpWriteSourceConfigInput,
} from '@shared/types/mcp'

export interface McpSourceDefinition {
  readonly id: McpConfigSourceId
  readonly label: string
  readonly path: string
  readonly scope: McpConfigSourceScope
  readonly kind: McpConfigSourceKind
  readonly editable: boolean
}

export interface LoadedSource {
  readonly definition: McpSourceDefinition
  readonly exists: boolean
  readonly rawJson: string
  readonly config: McpConfigFile
  readonly activeServers: McpServerMap
  readonly disabledServers: McpServerMap
  readonly parseError: string | null
}

export interface PiMcpConfigServiceOptions {
  readonly homeDir: string
  readonly agentDir: string
  readonly installAdapterPackage: (source: string, projectPath?: string | null) => Promise<void>
}

export interface OpenWaggleMcpRuntimeContext {
  readonly configPath: string
  readonly adapterCwd: string
}

export interface PiMcpConfigServiceForTests {
  readonly getView: (projectPath?: string | null) => Promise<McpSettingsView>
  readonly setAdapterEnabled: (
    enabled: boolean,
    projectPath?: string | null,
  ) => Promise<McpSettingsView>
  readonly setServerEnabled: (input: McpSetServerEnabledInput) => Promise<McpSettingsView>
  readonly writeSourceConfig: (input: McpWriteSourceConfigInput) => Promise<McpSettingsView>
  readonly prepareEffectiveConfig: (projectPath?: string | null) => Promise<string | null>
  readonly prepareRuntimeContext: (
    projectPath?: string | null,
  ) => Promise<OpenWaggleMcpRuntimeContext | null>
}

export const mcpRuntimeContextsByServices = new WeakMap<
  AgentSessionServices,
  OpenWaggleMcpRuntimeContext
>()
