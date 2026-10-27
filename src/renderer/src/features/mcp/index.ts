// The MCP Apps host (the MCP SDK, zod and the app bridge) stays out of this index: transcript rows
// import it for tool-result helpers, and `ToolCallRouter` loads the host only when a tool result
// launches an MCP App (renderer-load B8). Load it from `@/features/mcp/McpAppHost`.
export { parseMcpAppResource } from './mcp-app-resource'
export { getMcpAppLaunch } from './mcp-app-tool-result'
