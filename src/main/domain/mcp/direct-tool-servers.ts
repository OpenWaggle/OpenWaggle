import type { McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'

/** Whether a server exposes tools directly to the model, so a turn must list them before Pi starts. */
export function serverRequestsDirectTools(server: McpTurnSnapshotServer) {
  const selection = server.definition.directTools
  return selection === true || (Array.isArray(selection) && selection.length > 0)
}

/** The servers a turn connects before its first model call. The gateway connects the rest lazily. */
export function serversConnectedBeforeTurn(snapshot: McpTurnSnapshot | null) {
  if (!snapshot || snapshot.effectiveState !== 'on') return []
  return snapshot.servers.filter(serverRequestsDirectTools)
}
