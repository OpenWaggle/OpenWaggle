import type { McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'
import { Deferred, Effect, SynchronizedRef } from 'effect'
import { resolveMcpRuntimeNamespace } from '../../../domain/mcp/runtime-namespace'
import { type McpRuntimeFailure, toMcpRuntimeError } from '../../../ports/mcp-errors'
import type { McpRuntimeConnectionStatus } from '../../../ports/mcp-runtime-service'
import type { McpClientConnection, McpConnectionFactory } from './types'

function connectionKey(snapshot: McpTurnSnapshot, server: McpTurnSnapshotServer) {
  return `${resolveMcpRuntimeNamespace(snapshot)}:${snapshot.revision}:${server.instanceId}`
}

/**
 * A pending or resolved connection, deduplicated per key via a Deferred. The
 * connection status lives on the cell so status and lifetime mutate atomically
 * under one `SynchronizedRef` (no cross-ref check-then-act windows).
 */
interface ConnectionCell {
  readonly deferred: Deferred.Deferred<McpClientConnection, McpRuntimeFailure>
  readonly status: McpRuntimeConnectionStatus
}

interface ConnectionsCtx {
  readonly connect: McpConnectionFactory
  readonly onClose: (key: string) => Effect.Effect<void>
  readonly onConnected: (runtimeNamespace: string, serverInstanceId: string) => Effect.Effect<void>
  readonly cells: SynchronizedRef.SynchronizedRef<Map<string, ConnectionCell>>
}

export interface McpRuntimeConnectionsService {
  key(snapshot: McpTurnSnapshot, server: McpTurnSnapshotServer): string
  get(
    snapshot: McpTurnSnapshot,
    server: McpTurnSnapshotServer,
  ): Effect.Effect<McpClientConnection, McpRuntimeFailure>
  closeSuperseded(runtimeNamespace: string, snapshotRevision: string): Effect.Effect<void>
  closeRuntimeNamespace(runtimeNamespace: string): Effect.Effect<void>
  closeIdle(
    isActive: (runtimeNamespace: string) => boolean,
    additionalNamespaces: Iterable<string>,
  ): Effect.Effect<ReadonlySet<string>>
  closeAll(): Effect.Effect<void>
  getStatuses(): Effect.Effect<readonly McpRuntimeConnectionStatus[]>
}

function connectingStatus(
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

function connectedStatus(
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
  connection: McpClientConnection,
): McpRuntimeConnectionStatus {
  return {
    ...connectingStatus(snapshot, server),
    connectionState: 'connected',
    ...(connection.negotiatedProtocolVersion
      ? { negotiatedProtocolVersion: connection.negotiatedProtocolVersion }
      : {}),
    capabilities: connection.capabilities,
  }
}

function removeCell(ctx: ConnectionsCtx, key: string) {
  return SynchronizedRef.update(ctx.cells, (current) => {
    const next = new Map(current)
    next.delete(key)
    return next
  })
}

function runConnect(
  ctx: ConnectionsCtx,
  key: string,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
  deferred: Deferred.Deferred<McpClientConnection, McpRuntimeFailure>,
) {
  return Effect.tryPromise({
    try: () => ctx.connect({ snapshot, server }),
    catch: (error) => toMcpRuntimeError('connect', error),
  }).pipe(
    Effect.matchCauseEffect({
      onSuccess: (connection) =>
        // Atomically publish "connected" only if this cell is still current
        // (not superseded/closed by a concurrent turn). Status + presence check
        // happen in one modify, so a concurrent close cannot leave a ghost status.
        SynchronizedRef.modify(ctx.cells, (current) => {
          const existing = current.get(key)
          if (!existing) return [false, current] as const
          return [
            true,
            new Map(current).set(key, {
              ...existing,
              status: connectedStatus(snapshot, server, connection),
            }),
          ] as const
        }).pipe(
          Effect.flatMap((current) =>
            current
              ? ctx.onConnected(resolveMcpRuntimeNamespace(snapshot), server.instanceId)
              : Effect.void,
          ),
          Effect.zipRight(Deferred.succeed(deferred, connection)),
        ),
      onFailure: (cause) =>
        // Drop the failed cell so a later turn can reconnect, then fail waiters.
        removeCell(ctx, key).pipe(Effect.zipRight(Deferred.failCause(deferred, cause))),
    }),
  )
}

function getConnection(
  ctx: ConnectionsCtx,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
) {
  return Effect.gen(function* () {
    const key = connectionKey(snapshot, server)
    type Decision = {
      readonly deferred: Deferred.Deferred<McpClientConnection, McpRuntimeFailure>
      readonly fresh: boolean
    }
    const decision = yield* SynchronizedRef.modifyEffect(
      ctx.cells,
      (current): Effect.Effect<readonly [Decision, Map<string, ConnectionCell>]> => {
        const existing = current.get(key)
        if (existing)
          return Effect.succeed([{ deferred: existing.deferred, fresh: false }, current] as const)
        return Deferred.make<McpClientConnection, McpRuntimeFailure>().pipe(
          Effect.map(
            (deferred) =>
              [
                { deferred, fresh: true },
                new Map(current).set(key, { deferred, status: connectingStatus(snapshot, server) }),
              ] as const,
          ),
        )
      },
    )
    if (decision.fresh) {
      // Fork as a daemon so the Deferred is ALWAYS resolved (success or failure)
      // even if this calling fiber is interrupted (e.g. turn cancellation) before
      // runConnect completes. Otherwise the cell's Deferred would orphan and wedge
      // every later getConnection/closeKey (and Layer teardown) on this key.
      yield* Effect.forkDaemon(runConnect(ctx, key, snapshot, server, decision.deferred))
    }
    return yield* Deferred.await(decision.deferred)
  })
}

function closeKey(ctx: ConnectionsCtx, key: string) {
  return Effect.gen(function* () {
    // Atomically claim + remove the cell so a concurrent getConnection cannot
    // observe a cell this close is tearing down.
    const cell = yield* SynchronizedRef.modifyEffect(ctx.cells, (current) => {
      const next = new Map(current)
      const existing = next.get(key)
      next.delete(key)
      return Effect.succeed([existing, next] as const)
    })
    if (!cell) return
    yield* ctx.onClose(key)
    yield* Deferred.await(cell.deferred).pipe(
      Effect.matchCauseEffect({
        onSuccess: (connection) => Effect.promise(() => connection.close().catch(() => undefined)),
        onFailure: () => Effect.void,
      }),
    )
  })
}

function matchingKeys(
  ctx: ConnectionsCtx,
  predicate: (status: McpRuntimeConnectionStatus, key: string) => boolean,
) {
  return SynchronizedRef.get(ctx.cells).pipe(
    Effect.map((current) =>
      [...current.entries()].flatMap(([key, cell]) => (predicate(cell.status, key) ? [key] : [])),
    ),
  )
}

function closeKeys(ctx: ConnectionsCtx, keys: readonly string[]) {
  return Effect.forEach(keys, (key) => closeKey(ctx, key), { discard: true })
}

function closeIdle(
  ctx: ConnectionsCtx,
  isActive: (runtimeNamespace: string) => boolean,
  additionalNamespaces: Iterable<string>,
) {
  return Effect.gen(function* () {
    const current = yield* SynchronizedRef.get(ctx.cells)
    const idleNamespaces = new Set<string>()
    for (const cell of current.values()) {
      if (!isActive(cell.status.runtimeNamespace)) idleNamespaces.add(cell.status.runtimeNamespace)
    }
    for (const runtimeNamespace of additionalNamespaces) {
      if (!isActive(runtimeNamespace)) idleNamespaces.add(runtimeNamespace)
    }
    const keys = yield* matchingKeys(ctx, (status) => idleNamespaces.has(status.runtimeNamespace))
    yield* closeKeys(ctx, keys)
    return idleNamespaces
  })
}

/**
 * Build the Effect-native MCP connection pool. All mutable coordination lives in
 * a single `SynchronizedRef` (cell = deferred + status); in-flight connects are
 * deduplicated through a per-key `Deferred` so concurrent turns share one
 * connection. The SDK connect factory is the only Promise edge, wrapped once via
 * `Effect.tryPromise`.
 */
export function makeMcpRuntimeConnections(input: {
  readonly connect: McpConnectionFactory
  readonly onClose: (key: string) => Effect.Effect<void>
  readonly onConnected: (runtimeNamespace: string, serverInstanceId: string) => Effect.Effect<void>
}): Effect.Effect<McpRuntimeConnectionsService> {
  return Effect.gen(function* () {
    const cells = yield* SynchronizedRef.make(new Map<string, ConnectionCell>())
    const ctx: ConnectionsCtx = { ...input, cells }
    return {
      key: connectionKey,
      get: (snapshot, server) => getConnection(ctx, snapshot, server),
      closeSuperseded: (runtimeNamespace, snapshotRevision) =>
        matchingKeys(
          ctx,
          (status) =>
            status.runtimeNamespace === runtimeNamespace &&
            status.snapshotRevision !== snapshotRevision,
        ).pipe(Effect.flatMap((keys) => closeKeys(ctx, keys))),
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
          Effect.map((current) => [...current.values()].map((cell) => cell.status)),
        ),
    }
  })
}
