import type { McpTurnSnapshotServer } from '@shared/types/mcp'

/**
 * Whether a server exposes tools directly to the model, so a turn registers them with Pi before
 * it starts.
 */
export function serverRequestsDirectTools(server: McpTurnSnapshotServer) {
  const selection = server.definition.directTools
  return selection === true || (Array.isArray(selection) && selection.length > 0)
}

/** Whether a server's definition selects one of its tools to be exposed directly. */
export function serverOffersToolDirectly(server: McpTurnSnapshotServer, toolName: string) {
  const selection = server.definition.directTools
  return selection === true || (Array.isArray(selection) && selection.includes(toolName))
}
