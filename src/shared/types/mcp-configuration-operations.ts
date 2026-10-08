/**
 * Requests and results of the Settings > MCP and `openwaggle mcp` operations. They travel
 * through the Session Host (Host UI protocol revision 22) and are decoded by the schemas in
 * `src/shared/schemas/mcp-configuration.ts`.
 */
import type { McpJsonValue } from './mcp'
import type {
  McpConfigFileScope,
  McpConfigurationView,
  McpServerExposure,
  McpWriteDestination,
} from './mcp-configuration'

export interface McpConfigurationScopeRequest {
  /** The OpenWaggle project root; null shows and changes only the global files. */
  readonly projectPath: string | null
}

export interface McpServerNameRequest extends McpConfigurationScopeRequest {
  readonly name: string
}

export interface McpSetServerEnabledRequest extends McpServerNameRequest {
  readonly enabled: boolean
  /** `project` switches a global server for this project only. */
  readonly target: 'server' | 'project'
  readonly destination?: McpWriteDestination
}

export interface McpSetServerExposureRequest extends McpServerNameRequest {
  readonly exposure?: McpServerExposure
  /** Per-tool exposure; `null` removes a tool's own setting. */
  readonly toolExposure?: Readonly<Record<string, McpServerExposure | null>>
}

/** A Pi `mcpServers` entry as JSON. */
export type McpServerEntryInput = Readonly<Record<string, McpJsonValue>>

export interface McpAddServerRequest extends McpServerNameRequest {
  readonly scope: McpConfigFileScope
  /** Defaults to OpenWaggle's file for `scope`. */
  readonly destination?: McpWriteDestination
  readonly entry: McpServerEntryInput
}

export interface McpInstallCatalogServerRequest extends McpConfigurationScopeRequest {
  /** The `name` of an `MCP_CATALOG_SERVERS` item. */
  readonly catalogName: string
  readonly scope: McpConfigFileScope
  readonly destination?: McpWriteDestination
}

export interface McpSignInResultView {
  readonly signedIn: boolean
  /** The authorization page, when it could not be opened for the user. */
  readonly authorizationUrl?: string
}

export const MCP_IMPORT_SOURCE_IDS = [
  'codex',
  'claude-code',
  'claude-desktop',
  'cursor',
  'vscode',
  'opencode',
  'zed',
  'windsurf',
] as const

/** Tools whose MCP servers can be imported (Pi's own files are read live, not imported). */
export type McpImportSourceId = (typeof MCP_IMPORT_SOURCE_IDS)[number]

export type McpImportCandidateStatus = 'new' | 'imported' | 'source-changed' | 'name-taken'

export type McpImportNameConflictPolicy = 'skip' | 'replace' | 'rename'

export interface McpImportCandidateView {
  readonly source: McpImportSourceId
  readonly sourcePath: string
  readonly suggestedTarget: McpConfigFileScope
  /** The server's name in the other tool. */
  readonly name: string
  /** The name it gets in OpenWaggle's file. */
  readonly targetName: string
  /** The command line or URL, for display. */
  readonly target: string
  readonly fingerprint: string
  readonly warnings: readonly string[]
  readonly status: McpImportCandidateStatus
}

export interface McpImportSourceErrorView {
  readonly source: McpImportSourceId
  readonly path: string
  readonly message: string
}

export interface McpImportPreviewView {
  readonly candidates: readonly McpImportCandidateView[]
  readonly unavailableSources: readonly McpImportSourceId[]
  readonly errors: readonly McpImportSourceErrorView[]
}

/** A Session whose MCP switch is read; every Session is on until switched off. */
export interface McpSessionRequest {
  readonly sessionId: string
}

export interface McpSetSessionEnabledRequest extends McpSessionRequest {
  readonly enabled: boolean
}

export interface McpImportPreviewRequest extends McpConfigurationScopeRequest {
  readonly sources?: readonly McpImportSourceId[]
}

export interface McpImportApplyRequest extends McpImportPreviewRequest {
  readonly fingerprints: readonly string[]
  /** OpenWaggle's file for this scope receives the servers. */
  readonly target: McpConfigFileScope
  readonly conflictPolicy: McpImportNameConflictPolicy
}

export interface McpImportApplyResultView {
  readonly imported: readonly {
    readonly source: McpImportSourceId
    readonly sourceName: string
    readonly targetName: string
    readonly fingerprint: string
  }[]
  readonly skipped: readonly { readonly fingerprint: string; readonly reason: string }[]
  readonly view: McpConfigurationView
}
