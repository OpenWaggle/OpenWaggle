import { Schema } from '@shared/schema'
import type { McpServerId } from './brand'

export const MCP_TRANSPORTS = ['stdio', 'http'] as const
export type McpTransport = (typeof MCP_TRANSPORTS)[number]

export const MCP_CONNECTION_STATUSES = ['disconnected', 'connecting', 'connected', 'error'] as const
export type McpConnectionStatus = (typeof MCP_CONNECTION_STATUSES)[number]

export interface McpServerConfig {
  readonly id: McpServerId
  readonly name: string
  readonly transport: McpTransport
  readonly enabled: boolean
  /** stdio: command to spawn */
  readonly command?: string
  /** stdio: command arguments */
  readonly args?: readonly string[]
  /** stdio: environment variables */
  readonly env?: Readonly<Record<string, string>>
  /** http: server URL */
  readonly url?: string
}

export interface McpToolInfo {
  readonly serverName: string
  readonly name: string
  readonly namespacedName: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
}

export interface McpServerStatus {
  readonly id: McpServerId
  readonly name: string
  readonly status: McpConnectionStatus
  readonly error?: string
  readonly toolCount: number
  readonly tools: readonly McpToolInfo[]
}

/** Effect schema for validating McpServerConfig at IPC boundaries */
export const mcpServerConfigSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  name: Schema.String.pipe(Schema.minLength(1)),
  transport: Schema.Literal(...MCP_TRANSPORTS),
  enabled: Schema.Boolean,
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  url: Schema.optional(Schema.String),
})
