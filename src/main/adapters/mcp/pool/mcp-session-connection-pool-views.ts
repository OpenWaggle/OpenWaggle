import { realLocation } from '../config/mcp-config-files'
import type {
  McpPoolConnectionState,
  McpPoolServerStatus,
  SessionConnections,
} from './mcp-session-connection-pool-types'

/**
 * Whether a connection's project is `projectPath`, however either is spelled: by real folder, as
 * a Run records the Session's spelling (perhaps through a link) and Settings sends the real path.
 */
function sameProject(projectPath: string | null) {
  const wanted = projectPath === null ? null : realLocation(projectPath)
  return (other: string | null) => (other === null ? null : realLocation(other)) === wanted
}

/** Each server's clients, error and stderr of one Session, for Settings. */
export function poolServerStatus(session: SessionConnections | undefined): McpPoolServerStatus[] {
  if (!session) return []
  return [...session.servers].map(([name, { connection }]) => ({
    name,
    clients: connection.attachedLeases,
    ...(connection.lastError ? { lastError: connection.lastError } : {}),
    stderrTail: connection.stderrTail,
  }))
}

/**
 * The open connections to one server identity of the project's Sessions (`null`: Sessions with
 * no project), read without sending anything, touching recency, or handing a connection out: a
 * connection stays its Session's alone. Another project's Session connects on its own, so its
 * connection says nothing about the server there (ADR 0051). Nor does a connection still serving
 * the server's catalog without having started it (D1.3): Settings then shows the last check.
 */
export function connectionStatesOf(
  sessions: Iterable<SessionConnections>,
  identity: string,
  projectPath: string | null,
): McpPoolConnectionState[] {
  const project = sameProject(projectPath)
  return [...sessions].flatMap((session) =>
    [...session.servers.values()]
      .filter(
        (server) =>
          server.identity === identity &&
          project(server.projectPath) &&
          !server.connection.isClosed &&
          !server.connection.isServingCatalog,
      )
      .map(({ connection }) => ({
        ready: connection.isReady,
        ...(connection.lastError ? { lastError: connection.lastError } : {}),
      })),
  )
}
