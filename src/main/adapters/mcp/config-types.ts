import type {
  McpConfigFile,
  McpConfigSourceId,
  McpConfigSourceKind,
  McpConfigSourceScope,
  McpScopeState,
  McpServerDefinition,
  McpServerPermissionGrant,
} from '@shared/types/mcp'
import type { ActiveMcpTurn } from '../../domain/mcp/turn-application-state'

export interface McpSourceDefinition {
  readonly id: McpConfigSourceId
  readonly label: string
  readonly path: string
  readonly scope: McpConfigSourceScope
  readonly kind: McpConfigSourceKind
  readonly editable: boolean
}

export interface LoadedMcpSource {
  readonly definition: McpSourceDefinition
  readonly exists: boolean
  readonly rawJson: string
  readonly config: McpConfigFile
  readonly servers: Readonly<Record<string, McpServerDefinition>>
  readonly ignoredFields: readonly string[]
  readonly parseError: string | null
}

export interface McpServerUserState {
  readonly instanceId: string
  readonly enabled: boolean
  readonly trustedConfigHash?: string
  readonly allowUnsandboxed?: boolean
  readonly permissions?: McpServerPermissionGrant
}

export interface McpUserStateFile {
  readonly version: number
  readonly globalState: 'on' | 'off'
  readonly projectStates: Readonly<Record<string, McpScopeState>>
  readonly sessionStates: Readonly<Record<string, McpScopeState>>
  readonly servers: Readonly<Record<string, McpServerUserState>>
}

export interface ResolvedMcpServer {
  readonly identityKey: string
  readonly name: string
  readonly definition: McpServerDefinition
  readonly source: LoadedMcpSource
  readonly configHash: string
  readonly state: McpServerUserState
  readonly issues: readonly string[]
}

export interface McpFilesystemConfigServiceOptions {
  readonly homeDir: string
  readonly createId: () => string
  /**
   * Reads the active MCP turn for a session so the settings view can report
   * applied/pending integration state. Defaults to reporting no active turn.
   */
  readonly getActiveTurn?: (sessionId: string | null) => ActiveMcpTurn | undefined
}
