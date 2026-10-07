import type { McpJsonValue } from '@shared/types/mcp'
import { Context, type Effect } from 'effect'

export interface McpAppServerInput {
  /** The durable project root the Session belongs to. */
  readonly projectPath: string | null
  readonly sessionId: string
  readonly serverName: string
  /** The grant identity the App was opened with; a replaced server is refused. */
  readonly serverIdentity: string
}

export interface McpAppToolResultValue {
  readonly content: McpJsonValue
  readonly structuredContent?: McpJsonValue
  readonly isError: boolean
}

/**
 * MCP Apps read their `ui://` resources and call their server's tools over the Session's pooled
 * connection, opening it when the Session has none.
 */
export interface McpAppRuntimeServiceShape {
  readonly readResource: (
    input: McpAppServerInput & { readonly uri: string },
  ) => Effect.Effect<McpJsonValue, Error>
  readonly callTool: (
    input: McpAppServerInput & {
      readonly toolName: string
      readonly arguments: Readonly<Record<string, McpJsonValue>>
    },
  ) => Effect.Effect<McpAppToolResultValue, Error>
}

export class McpAppRuntimeService extends Context.Tag('@openwaggle/McpAppRuntimeService')<
  McpAppRuntimeService,
  McpAppRuntimeServiceShape
>() {}
