import { z } from 'zod'
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

/** Zod schema for validating McpServerConfig at IPC boundaries */
export const mcpServerConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  transport: z.enum(MCP_TRANSPORTS),
  enabled: z.boolean(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
})
