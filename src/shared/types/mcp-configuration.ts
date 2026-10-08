/**
 * Settings > MCP and the MCP CLI read and change the ADR 0050 file set through these shapes. They
 * describe Pi's configuration as OpenWaggle merges it; nothing here is OpenWaggle-only state
 * except a Session's MCP switch.
 */

export const MCP_EXPOSURE_VALUES = ['codemode', 'deferred', 'direct', 'hidden'] as const

export type McpServerExposure = (typeof MCP_EXPOSURE_VALUES)[number]

export const MCP_CONFIG_FILE_ID_VALUES = [
  'pi-global',
  'openwaggle-global',
  'project-mcp-json',
  'project-pi',
  'project-openwaggle',
] as const

/** One of the five MCP files, lowest precedence first. */
export type McpConfigFileKind = (typeof MCP_CONFIG_FILE_ID_VALUES)[number]

export type McpConfigFileScope = 'global' | 'project'

export type McpServerTransportKind = 'stdio' | 'http' | 'sse' | 'websocket'

export interface McpConfigFileView {
  readonly fileId: McpConfigFileKind
  readonly path: string
  readonly scope: McpConfigFileScope
  readonly exists: boolean
  /** OpenWaggle's own file for its scope: the default destination for new servers. */
  readonly openWaggleOwned: boolean
}

export interface McpServerFileReference {
  readonly fileId: McpConfigFileKind
  readonly path: string
}

export interface McpConfiguredServerView {
  readonly name: string
  readonly transport: McpServerTransportKind
  /** The command line or URL, for display. Never includes secret values. */
  readonly target: string
  readonly description?: string
  readonly source: McpServerFileReference
  readonly scope: McpConfigFileScope
  readonly override?: McpServerFileReference
  /** The override turned the server off; the file that defines it does not. */
  readonly offByOverride?: true
  readonly enabled: boolean
  readonly exposure: McpServerExposure
  readonly toolExposure: Readonly<Record<string, McpServerExposure>>
  /** HTTP servers without an Authorization header or provider auth sign in with OAuth. */
  readonly usesOAuth: boolean
}

export interface McpConfigurationView {
  readonly projectPath: string | null
  readonly files: readonly McpConfigFileView[]
  readonly servers: readonly McpConfiguredServerView[]
  /** Unreadable files and invalid entries, as Pi reports them. */
  readonly errors: readonly string[]
}

export type McpServerConnectionStateView =
  | 'not-connected'
  | 'connecting'
  | 'connected'
  | 'needs-sign-in'
  | 'failed'
  | 'disabled'

export interface McpServerToolView {
  readonly name: string
  readonly title?: string
  readonly description?: string
  /** Exposure after `toolExposure` is applied. */
  readonly exposure: McpServerExposure
  /** The tool renders an MCP App (`ui://` resource). */
  readonly hasApp: boolean
}

export interface McpServerInspection {
  readonly name: string
  readonly state: McpServerConnectionStateView
  readonly tools: readonly McpServerToolView[]
  readonly error?: string
  readonly stderrTail?: string
  readonly signedIn?: boolean
}

/**
 * Where a server state read without connecting comes from: a Session's warm connection, the last
 * check ("Check connection", `openwaggle mcp list`, or a Run listing its tools), or nothing yet.
 */
export type McpServerStatusSource = 'live' | 'last-check' | 'not-checked'

/** A server's state as Settings > MCP shows it on open. Reading it never starts a server. */
export interface McpServerStatusView {
  readonly name: string
  readonly source: McpServerStatusSource
  /** The state and tools; absent when the server was never checked. */
  readonly inspection?: McpServerInspection
  /** When the last check happened (epoch milliseconds), for `last-check`. */
  readonly checkedAt?: number
  /** Whether OpenWaggle holds a sign-in, for OAuth servers. Read from the store, not the server. */
  readonly signedIn?: boolean
}

/** Where a new server, a per-project switch, or an install goes. */
export type McpWriteDestination = McpConfigFileKind
