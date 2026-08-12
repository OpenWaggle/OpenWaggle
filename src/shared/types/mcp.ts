export const MCP_CONFIG_SOURCE_IDS = [
  'global-openwaggle',
  'project-standard',
  'project-openwaggle',
] as const

export type McpConfigSourceId = (typeof MCP_CONFIG_SOURCE_IDS)[number]

export type McpConfigSourceScope = 'global' | 'project'

export type McpConfigSourceKind = 'standard' | 'openwaggle'

export type McpConfigPrimitive = string | number | boolean | null

export type McpConfigValue = McpConfigPrimitive | McpConfigObject | McpConfigArray

export interface McpConfigObject {
  [key: string]: McpConfigValue
}

export type McpConfigArray = McpConfigValue[]

export type McpJsonValue = McpConfigValue

export type McpScope = 'global' | 'project' | 'session'

export type McpScopeState = 'inherit' | 'on' | 'off'

export type McpEffectiveState = 'on' | 'off'

export type McpApplyState = 'applied' | 'pending'

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
  readonly source: McpImportSource | 'registry' | 'manual'
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

export interface McpConfigSourceSummary {
  readonly id: McpConfigSourceId
  readonly label: string
  readonly path: string
  readonly scope: McpConfigSourceScope
  readonly kind: McpConfigSourceKind
  readonly exists: boolean
  readonly editable: boolean
  readonly serverCount: number
  readonly rawJson: string
  readonly ignoredFields: readonly string[]
  readonly parseError?: string
}

export interface McpScopeResolution {
  readonly global: Exclude<McpScopeState, 'inherit'>
  readonly project: McpScopeState
  readonly session: McpScopeState
  readonly effective: McpEffectiveState
  readonly source: McpScope
}

export interface McpIntegrationState {
  readonly desired: McpScopeResolution
  readonly applied: McpEffectiveState
  readonly applyState: McpApplyState
  readonly pendingReason?: string
}

export type McpServerConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'degraded'
  | 'blocked'

export type McpTrustState = 'untrusted' | 'trusted' | 'invalidated'

export type McpDirectToolsMode = 'enabled' | 'disabled' | 'partial' | 'inherited'

/**
 * Filesystem and network authority explicitly approved by the user for a local
 * stdio server. Paths remain config-relative here and are resolved against the
 * immutable turn execution path only when the sandbox is created.
 */
export interface McpServerPermissionGrant {
  readonly readRoots: readonly string[]
  readonly writeRoots: readonly string[]
  readonly allowNetwork: boolean
}

export type McpCapabilityFamily =
  | 'tools'
  | 'prompts'
  | 'resources'
  | 'tasks'
  | 'apps'
  | 'elicitation'
  | 'subscriptions'
  | 'skills'
  | 'sampling-legacy'
  | 'roots-legacy'
  | 'logging-legacy'

export interface McpServerSummary {
  readonly instanceId: string
  readonly name: string
  readonly enabled: boolean
  /** Whether this server is enabled for the project the view was built for. Default true; false when muted per-project. */
  readonly projectEnabled: boolean
  readonly trusted: McpTrustState
  readonly required: boolean
  readonly sourceId: McpConfigSourceId
  readonly sourceLabel: string
  readonly sourcePath: string
  readonly configHash: string
  readonly command?: string
  readonly url?: string
  readonly transport: McpServerTransport
  readonly compatibility: McpCompatibilityProfile
  readonly directTools: McpDirectToolsMode
  readonly auth: 'none' | 'oauth'
  /** Permissions requested by the current config and shown before trust. */
  readonly requestedPermissions: McpServerPermissionGrant
  /** Permissions approved for the trusted config hash, if any. */
  readonly grantedPermissions?: McpServerPermissionGrant
  readonly connectionState: McpServerConnectionState
  readonly negotiatedProtocolVersion?: string
  readonly capabilities: readonly McpCapabilityFamily[]
  readonly blockedReason?: string
  readonly lastError?: string
}

export interface McpRuntimeNotice {
  readonly id: string
  readonly severity: 'info' | 'warning' | 'error'
  readonly title: string
  readonly detail: string
  readonly action?: string
  readonly serverInstanceId?: string
}

export interface McpSettingsView {
  readonly integration: McpIntegrationState
  readonly sources: readonly McpConfigSourceSummary[]
  readonly servers: readonly McpServerSummary[]
  readonly notices: readonly McpRuntimeNotice[]
  /** Raw per-project scope overrides (project master switches), keyed by project path. */
  readonly projectStates: Readonly<Record<string, McpScopeState>>
  readonly projectPath: string | null
  readonly sessionId: string | null
}

export interface McpGetSettingsInput {
  readonly projectPath?: string | null
  readonly sessionId?: string | null
}

export interface McpSetScopeStateInput extends McpGetSettingsInput {
  readonly scope: McpScope
  readonly state: McpScopeState
}

export interface McpSetServerEnabledInput extends McpGetSettingsInput {
  readonly instanceId: string
  readonly enabled: boolean
}

export interface McpSetProjectServerEnabledInput extends McpGetSettingsInput {
  readonly instanceId: string
  readonly enabled: boolean
}

export interface McpSetServerTrustInput extends McpGetSettingsInput {
  readonly instanceId: string
  readonly trusted: boolean
  readonly allowUnsandboxed?: boolean
  readonly permissions?: McpServerPermissionGrant
}

export interface McpWriteSourceConfigInput {
  readonly projectPath?: string | null
  readonly sourceId: McpConfigSourceId
  readonly rawJson: string
}

export interface McpRemoveServerInput extends McpGetSettingsInput {
  readonly instanceId: string
}

export type McpAuthorizeServerInput = McpRemoveServerInput

export interface McpAuthorizeServerResult {
  readonly authorized: boolean
  readonly browserOpened: boolean
}

export interface McpTurnSnapshotServer {
  readonly instanceId: string
  readonly name: string
  readonly sourcePath: string
  readonly configHash: string
  readonly allowUnsandboxed: boolean
  readonly permissions: McpServerPermissionGrant
  readonly definition: McpServerDefinition
}

export interface McpTurnSnapshot {
  readonly id: string
  readonly sessionId: string
  /** Isolates management connections without changing logical session-scoped state. */
  readonly runtimeNamespace?: string
  /** Stable logical repository identity used for config, trust, and project-scoped state. */
  readonly projectPath: string
  /** Effective execution cwd, which may be an isolated per-session worktree. */
  readonly executionPath?: string
  readonly revision: string
  readonly createdAt: number
  readonly effectiveState: McpEffectiveState
  readonly servers: readonly McpTurnSnapshotServer[]
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

export * from './mcp-capabilities'
export * from './mcp-gateway'
export * from './mcp-management'
