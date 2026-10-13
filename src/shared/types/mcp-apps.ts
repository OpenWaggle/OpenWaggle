import type { McpJsonValue } from './mcp'

/** The project and Session an MCP App request is made for. */
export interface McpAppRequestScope {
  readonly projectPath?: string | null
  readonly sessionId?: string | null
}

/** An MCP App a tool result opened: the server, tool, and `ui://` resource it renders. */
export interface McpAppDescriptor {
  readonly serverInstanceId: string
  readonly serverLabel: string
  readonly serverConfigHash: string
  readonly toolHandle: string
  readonly toolName: string
  readonly toolTitle: string
  readonly resourceUri: string
  readonly allowedNetworkDomains: readonly string[]
}

export interface McpResourceResult {
  readonly contents: McpJsonValue
  readonly attribution: { readonly serverInstanceId: string; readonly serverLabel: string }
}

export interface McpAppToolCallInput extends McpAppRequestScope {
  readonly serverInstanceId: string
  readonly serverConfigHash: string
  readonly toolName: string
  readonly arguments: Readonly<Record<string, McpJsonValue>>
}

export interface McpAppToolCallResult {
  readonly content: McpJsonValue
  readonly structuredContent?: McpJsonValue
  readonly isError: boolean
  readonly attribution: {
    readonly serverInstanceId: string
    readonly serverLabel: string
    readonly toolName: string
  }
}

/** The server of an open MCP App, for listing what else it offers (`resources/list`, `prompts/list`). */
export interface McpAppCatalogInput extends McpAppRequestScope {
  readonly serverInstanceId: string
  readonly serverConfigHash?: string
}

export interface McpAppCatalogResult {
  readonly resources: McpJsonValue
  readonly prompts: McpJsonValue
  readonly attribution: { readonly serverInstanceId: string; readonly serverLabel: string }
}

export interface McpReadResourceInput extends McpAppRequestScope {
  readonly serverInstanceId: string
  readonly serverConfigHash?: string
  readonly uri: string
}
