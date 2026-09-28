import type { McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'
import { Duration, Effect, SynchronizedRef } from 'effect'
import type { McpRuntimeFailure } from '../../../ports/mcp-errors'
import type { McpRuntimeConnectionStatus } from '../../../ports/mcp-runtime-service'
import { closeIdle, closeKey, closeKeys, matchingKeys } from './runtime-connection-close'
import { getConnection, isCurrentConnection, startConnection } from './runtime-connection-open'
import type { ConnectionAttempt, ConnectionSlot, ConnectionsCtx } from './runtime-connection-slots'
import { mcpConnectionKey } from './runtime-connection-status'
import type { McpClientConnection, McpConnectionFactory } from './types'

export type { ConnectionAttempt } from './runtime-connection-slots'

/** Longer than the SDK's stdio escalation (EOF, then SIGTERM after 2 s, then SIGKILL after 2 s). */
const SHUTDOWN_TEARDOWN_DEADLINE_MS = 5_000

export interface McpRuntimeConnectionsService {
  key(snapshot: McpTurnSnapshot, server: McpTurnSnapshotServer): string
  get(
    snapshot: McpTurnSnapshot,
    server: McpTurnSnapshotServer,
  ): Effect.Effect<McpClientConnection, McpRuntimeFailure>
  /** Starts the connection without waiting for it; see `startConnection`. */
  start(snapshot: McpTurnSnapshot, server: McpTurnSnapshotServer): Effect.Effect<ConnectionAttempt>
  isCurrent(key: string, connection: McpClientConnection): Effect.Effect<boolean>
  /** The retirement signals of every slot's connection attempt, or of one server's. */
  attempts(serverInstanceId?: string): Effect.Effect<readonly AbortSignal[]>
  closeSuperseded(runtimeNamespace: string, snapshotRevision: string): Effect.Effect<void>
  closeKey(key: string): Effect.Effect<void>
  closeIfCurrent(key: string, connection: McpClientConnection): Effect.Effect<void>
  closeRuntimeNamespace(runtimeNamespace: string): Effect.Effect<void>
  closeIdle(
    isActive: (runtimeNamespace: string) => boolean,
    additionalNamespaces: Iterable<string>,
  ): Effect.Effect<ReadonlySet<string>>
  closeAll(): Effect.Effect<void>
  getStatuses(): Effect.Effect<readonly McpRuntimeConnectionStatus[]>
}
/** Effect-native, per-key connection pool with deduplicated in-flight connects. */
export function makeMcpRuntimeConnections(input: {
  readonly connect: McpConnectionFactory
  readonly onClose: (key: string) => Effect.Effect<void>
  readonly onConnected: (runtimeNamespace: string, serverInstanceId: string) => Effect.Effect<void>
}): Effect.Effect<McpRuntimeConnectionsService> {
  return Effect.gen(function* () {
    const cells = yield* SynchronizedRef.make(new Map<string, ConnectionSlot>())
    const ctx: ConnectionsCtx = { ...input, cells }
    return {
      key: mcpConnectionKey,
      get: (snapshot, server) => getConnection(ctx, snapshot, server),
      start: (snapshot, server) => startConnection(ctx, snapshot, server),
      isCurrent: (key, connection) => isCurrentConnection(ctx, key, connection),
      attempts: (serverInstanceId) =>
        SynchronizedRef.get(cells).pipe(
          Effect.map((current) =>
            [...current.values()].flatMap((slot) =>
              serverInstanceId === undefined ||
              slot.cell.status.serverInstanceId === serverInstanceId
                ? [slot.cell.abort.signal]
                : [],
            ),
          ),
        ),
      closeSuperseded: (runtimeNamespace, snapshotRevision) =>
        matchingKeys(
          ctx,
          (status) =>
            status.runtimeNamespace === runtimeNamespace &&
            status.snapshotRevision !== snapshotRevision,
        ).pipe(Effect.flatMap((keys) => closeKeys(ctx, keys))),
      closeKey: (key) => closeKey(ctx, key),
      closeIfCurrent: (key, connection) => closeKey(ctx, key, { expectedConnection: connection }),
      closeRuntimeNamespace: (runtimeNamespace) =>
        matchingKeys(ctx, (status) => status.runtimeNamespace === runtimeNamespace).pipe(
          Effect.flatMap((keys) => closeKeys(ctx, keys)),
        ),
      closeIdle: (isActive, additionalNamespaces) => closeIdle(ctx, isActive, additionalNamespaces),
      // Shutdown: wait for every server to be gone, but not forever.
      closeAll: () =>
        SynchronizedRef.get(cells).pipe(
          Effect.flatMap((current) =>
            closeKeys(ctx, [...current.keys()], { settle: true }).pipe(
              Effect.timeoutOption(Duration.millis(SHUTDOWN_TEARDOWN_DEADLINE_MS)),
              Effect.asVoid,
            ),
          ),
        ),
      getStatuses: () =>
        SynchronizedRef.get(cells).pipe(
          Effect.map((current) =>
            [...current.values()].flatMap((slot) =>
              slot.type === 'active' ? [slot.cell.status] : [],
            ),
          ),
        ),
    }
  })
}
