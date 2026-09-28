import type { McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'
import { Effect, SynchronizedRef } from 'effect'
import type { McpRuntimeFailure } from '../../../ports/mcp-errors'
import type { McpRuntimeConnectionStatus } from '../../../ports/mcp-runtime-service'
import { closeIdle, closeKey, closeKeys, matchingKeys } from './runtime-connection-close'
import { getConnection, isCurrentConnection, startConnection } from './runtime-connection-open'
import type { ConnectionAttempt, ConnectionSlot, ConnectionsCtx } from './runtime-connection-slots'
import { mcpConnectionKey } from './runtime-connection-status'
import type { McpClientConnection, McpConnectionFactory } from './types'

export type { ConnectionAttempt } from './runtime-connection-slots'

export interface McpRuntimeConnectionsService {
  key(snapshot: McpTurnSnapshot, server: McpTurnSnapshotServer): string
  get(
    snapshot: McpTurnSnapshot,
    server: McpTurnSnapshotServer,
  ): Effect.Effect<McpClientConnection, McpRuntimeFailure>
  /** Starts the connection without waiting for it; see `startConnection`. */
  start(snapshot: McpTurnSnapshot, server: McpTurnSnapshotServer): Effect.Effect<ConnectionAttempt>
  isCurrent(key: string, connection: McpClientConnection): Effect.Effect<boolean>
  /** The keys of every slot, or of one server's slots. */
  keys(serverInstanceId?: string): Effect.Effect<readonly string[]>
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
      keys: (serverInstanceId) =>
        matchingKeys(
          ctx,
          (status) =>
            serverInstanceId === undefined || status.serverInstanceId === serverInstanceId,
        ),
      closeSuperseded: (runtimeNamespace, snapshotRevision) =>
        matchingKeys(
          ctx,
          (status) =>
            status.runtimeNamespace === runtimeNamespace &&
            status.snapshotRevision !== snapshotRevision,
        ).pipe(Effect.flatMap((keys) => closeKeys(ctx, keys))),
      closeKey: (key) => closeKey(ctx, key),
      closeIfCurrent: (key, connection) => closeKey(ctx, key, connection),
      closeRuntimeNamespace: (runtimeNamespace) =>
        matchingKeys(ctx, (status) => status.runtimeNamespace === runtimeNamespace).pipe(
          Effect.flatMap((keys) => closeKeys(ctx, keys)),
        ),
      closeIdle: (isActive, additionalNamespaces) => closeIdle(ctx, isActive, additionalNamespaces),
      closeAll: () =>
        SynchronizedRef.get(cells).pipe(
          Effect.flatMap((current) => closeKeys(ctx, [...current.keys()])),
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
