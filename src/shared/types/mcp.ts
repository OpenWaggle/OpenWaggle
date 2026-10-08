/** JSON values MCP messages, MCP App payloads, and entry forms carry. */
export type McpConfigPrimitive = string | number | boolean | null

export type McpConfigValue = McpConfigPrimitive | McpConfigObject | McpConfigArray

export interface McpConfigObject {
  [key: string]: McpConfigValue
}

export type McpConfigArray = McpConfigValue[]

export type McpJsonValue = McpConfigValue

export * from './mcp-apps'
export * from './mcp-management'
