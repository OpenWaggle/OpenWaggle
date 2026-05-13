export const MCP_CONFIG_SOURCE_IDS = [
  'global-standard',
  'global-pi',
  'project-standard',
  'project-agents',
  'project-pi',
  'project-openwaggle',
] as const

export type McpConfigSourceId = (typeof MCP_CONFIG_SOURCE_IDS)[number]

export type McpConfigSourceScope = 'global' | 'project'

export type McpConfigSourceKind = 'standard' | 'pi' | 'agents' | 'openwaggle'

export type McpConfigPrimitive = string | number | boolean | null

export type McpConfigValue = McpConfigPrimitive | McpConfigObject | McpConfigArray

export interface McpConfigObject {
  [key: string]: McpConfigValue
}

export type McpConfigArray = McpConfigValue[]

export type McpDirectToolsConfig = boolean | string[]

export type McpServerDefinition = McpConfigObject & {
  readonly command?: string
  readonly url?: string
  readonly directTools?: McpDirectToolsConfig
}

export type McpServerMap = Record<string, McpServerDefinition>

export type McpAdapterSettings = McpConfigObject

export type McpOpenWaggleConfig = McpConfigObject & {
  disabledMcpServers?: McpServerMap
}

export type McpConfigFile = McpConfigObject & {
  imports?: string[]
  settings?: McpAdapterSettings
  mcpServers?: McpServerMap
  'mcp-servers'?: McpServerMap
  openwaggle?: McpOpenWaggleConfig
}

export type McpPackageSourceObject = McpConfigObject & {
  source: string
}

export type McpPackageEntry = string | McpPackageSourceObject

export type PiAgentSettingsFile = McpConfigObject & {
  packages?: McpPackageEntry[]
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
  readonly disabledServerCount: number
  readonly rawJson: string
  readonly parseError?: string
}

export interface McpAdapterState {
  readonly enabled: boolean
  readonly packageSource: string
  readonly runtimeConfigPath: string | null
  readonly lastError?: string
}

export interface McpEffectiveConfig {
  readonly mcpServers: McpServerMap
  readonly disabledMcpServers: McpServerMap
  readonly settings: McpAdapterSettings
  readonly imports: readonly string[]
}

export type McpServerTransport = 'stdio' | 'http' | 'unknown'

export type McpDirectToolsMode = 'enabled' | 'disabled' | 'partial' | 'inherited'

export interface McpServerSummary {
  readonly name: string
  readonly enabled: boolean
  readonly sourceId: McpConfigSourceId
  readonly sourceLabel: string
  readonly sourcePath: string
  readonly command?: string
  readonly url?: string
  readonly transport: McpServerTransport
  readonly directTools: McpDirectToolsMode
}

export interface McpSettingsView {
  readonly adapter: McpAdapterState
  readonly sources: readonly McpConfigSourceSummary[]
  readonly effective: McpEffectiveConfig
  readonly servers: readonly McpServerSummary[]
  readonly runtimeConfigPath: string | null
}

export interface McpSetAdapterEnabledInput {
  readonly enabled: boolean
  readonly projectPath?: string | null
}

export interface McpSetServerEnabledInput {
  readonly projectPath?: string | null
  readonly sourceId: McpConfigSourceId
  readonly serverName: string
  readonly enabled: boolean
}

export interface McpWriteSourceConfigInput {
  readonly projectPath?: string | null
  readonly sourceId: McpConfigSourceId
  readonly rawJson: string
}
