/*
 * OpenWaggle's pre-ADR-0048 MCP file format (`mcp.json` entries with OpenWaggle-only fields such
 * as `directTools`, `security`, and `clientCapabilities`). The import adapters and the one-time
 * migration still read it; Pi's entry format is defined by the new MCP configuration modules.
 */

export type McpConfigPrimitive = string | number | boolean | null

export type McpConfigValue = McpConfigPrimitive | McpConfigObject | McpConfigArray

export interface McpConfigObject {
  [key: string]: McpConfigValue
}

export type McpConfigArray = McpConfigValue[]

export type McpJsonValue = McpConfigValue

export type McpScopeState = 'inherit' | 'on' | 'off'

export type McpServerTransport = 'stdio' | 'streamable-http' | 'sse' | 'websocket' | 'unknown'

export type McpCompatibilityProfile =
  | 'auto'
  | 'modern-only'
  | 'legacy-stateful-http'
  | 'legacy-sse'
  | 'legacy-websocket'

export type McpDirectToolsConfig = boolean | string[]

export interface McpSecretReference extends McpConfigObject {
  readonly secret: string
}

export type McpConfigCredentialValue = string | McpSecretReference

export type McpServerSecurityConfig = McpConfigObject & {
  readonly allowUnsandboxed?: boolean
  readonly allowNetwork?: boolean
  readonly allowInsecurePrivateNetwork?: boolean
  readonly readRoots?: string[]
  readonly writeRoots?: string[]
  readonly networkDomains?: string[]
  readonly oauthDomains?: string[]
}

export type McpServerOAuthConfig = McpConfigObject & {
  readonly type: 'oauth'
  readonly scopes?: string[]
  readonly clientMetadataUrl?: string
}

export type McpLoggingLevel =
  | 'debug'
  | 'info'
  | 'notice'
  | 'warning'
  | 'error'
  | 'critical'
  | 'alert'
  | 'emergency'

export type McpServerClientCapabilitiesConfig = McpConfigObject & {
  /** Permit reviewed form elicitation. URL mode must be enabled separately. */
  readonly elicitation?: false | 'form' | 'form-and-url'
  /** Legacy sampling is denied unless this is explicitly true. */
  readonly sampling?: boolean
  /** Expose read-only root hints. Effective filesystem authority remains policy-owned. */
  readonly roots?: boolean
  /** Receive bounded server log notifications at this level. */
  readonly loggingLevel?: McpLoggingLevel | 'off'
  /** Enable draft SEP-2640 remote Skills for this server. Disabled by default. */
  readonly remoteSkills?: boolean
}

export type McpServerProvenance = McpConfigObject & {
  readonly source: McpImportSource | 'registry' | 'manual' | 'catalog'
  readonly sourcePath?: string
  readonly fingerprint?: string
  readonly importedAt?: string
  readonly registryName?: string
  readonly registryVersion?: string
  readonly packageCoordinate?: string
  readonly packageDigest?: string
}

export type McpServerDefinition = McpConfigObject & {
  readonly command?: string
  readonly args?: string[]
  readonly cwd?: string
  readonly env?: Record<string, McpConfigCredentialValue>
  readonly url?: string
  readonly headers?: Record<string, McpConfigCredentialValue>
  readonly transport?: McpServerTransport
  readonly compatibility?: McpCompatibilityProfile
  readonly protocolVersion?: string
  readonly directTools?: McpDirectToolsConfig
  readonly required?: boolean
  readonly security?: McpServerSecurityConfig
  readonly auth?: McpServerOAuthConfig
  readonly clientCapabilities?: McpServerClientCapabilitiesConfig
  readonly provenance?: McpServerProvenance
}

export type McpServerMap = Record<string, McpServerDefinition>

export type McpOpenWaggleConfig = McpConfigObject & {
  readonly state?: McpScopeState
}

export type McpConfigFile = McpConfigObject & {
  readonly mcpServers?: McpServerMap
  readonly servers?: McpServerMap
  readonly openwaggle?: McpOpenWaggleConfig
}

export type McpImportSource =
  | 'codex'
  | 'claude-code'
  | 'claude-desktop'
  | 'opencode'
  | 'pi'
  | 'vscode'
  | 'cursor'
  | 'windsurf'
  | 'zed'

export * from './mcp-apps'
export * from './mcp-management'
