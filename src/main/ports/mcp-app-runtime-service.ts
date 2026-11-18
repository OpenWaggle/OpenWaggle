import type { McpJsonValue } from '@shared/types/mcp'
import { Context, type Effect } from 'effect'

export interface McpAppServerInput {
  /** The durable project root the Session belongs to. */
  readonly projectPath: string | null
  /** Where the Session's Runs work (its worktree, or the project), which its servers start in. */
  readonly workingPath: string | null
  readonly sessionId: string
  readonly serverName: string
  /** The grant identity the App was opened with; a replaced server is refused. */
  readonly serverIdentity: string
}

/** What the App's server offers beside its tools, from `resources/list` and `prompts/list`. */
export interface McpAppCatalogValue {
  readonly resources: McpJsonValue
  readonly prompts: McpJsonValue
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
  readonly listCatalog: (input: McpAppServerInput) => Effect.Effect<McpAppCatalogValue, Error>
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
