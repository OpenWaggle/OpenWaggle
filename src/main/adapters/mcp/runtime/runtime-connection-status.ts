import type { McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'
import { resolveMcpRuntimeNamespace } from '../../../domain/mcp/runtime-namespace'
import type { McpRuntimeConnectionStatus } from '../../../ports/mcp-runtime-service'
import type { McpClientConnection } from './types'

export function mcpConnectionKey(snapshot: McpTurnSnapshot, server: McpTurnSnapshotServer) {
  return `${resolveMcpRuntimeNamespace(snapshot)}:${snapshot.revision}:${server.instanceId}`
}

export function mcpConnectingStatus(
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
): McpRuntimeConnectionStatus {
  return {
    runtimeNamespace: resolveMcpRuntimeNamespace(snapshot),
    sessionId: snapshot.sessionId,
    projectPath: snapshot.projectPath,
    snapshotRevision: snapshot.revision,
    serverInstanceId: server.instanceId,
    connectionState: 'connecting',
    capabilities: [],
  }
}

export function mcpConnectedStatus(
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
  connection: McpClientConnection,
): McpRuntimeConnectionStatus {
  return {
    ...mcpConnectingStatus(snapshot, server),
    connectionState: 'connected',
    ...(connection.negotiatedProtocolVersion
      ? { negotiatedProtocolVersion: connection.negotiatedProtocolVersion }
      : {}),
    capabilities: connection.capabilities,
  }
}
