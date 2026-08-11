import type { McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'
import { Deferred, Effect, SynchronizedRef } from 'effect'
import { resolveMcpRuntimeNamespace } from '../../../domain/mcp/runtime-namespace'
import { type McpRuntimeFailure, toMcpRuntimeError } from '../../../ports/mcp-errors'
import type { McpRuntimeConnectionStatus } from '../../../ports/mcp-runtime-service'
import type { McpClientConnection, McpConnectionFactory } from './types'

function connectionKey(snapshot: McpTurnSnapshot, server: McpTurnSnapshotServer) {
  return `${resolveMcpRuntimeNamespace(snapshot)}:${snapshot.revision}:${server.instanceId}`
}

/** A pending or resolved connection, deduplicated per key via a Deferred. */
interface ConnectionCell {
  readonly deferred: Deferred.Deferred<McpClientConnection, McpRuntimeFailure>
}

interface ConnectionsCtx {
  readonly connect: McpConnectionFactory
  readonly onClose: (key: string) => Effect.Effect<void>
  readonly onConnected: (runtimeNamespace: string, serverInstanceId: string) => Effect.Effect<void>
  readonly cells: SynchronizedRef.SynchronizedRef<Map<string, ConnectionCell>>
  readonly statuses: SynchronizedRef.SynchronizedRef<Map<string, McpRuntimeConnectionStatus>>
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

function baseStatus(
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

function setStatus(ctx: ConnectionsCtx, key: string, status: McpRuntimeConnectionStatus) {
  return SynchronizedRef.update(ctx.statuses, (current) => new Map(current).set(key, status))
}

function deleteFromMap<V>(ref: SynchronizedRef.SynchronizedRef<Map<string, V>>, key: string) {
  return SynchronizedRef.update(ref, (current) => {
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
        // Only publish "connected" if this cell is still current (not superseded).
        SynchronizedRef.get(ctx.cells).pipe(
          Effect.flatMap((current) =>
            current.get(key)
              ? setStatus(ctx, key, {
                  ...baseStatus(snapshot, server),
                  connectionState: 'connected',
                  ...(connection.negotiatedProtocolVersion
                    ? { negotiatedProtocolVersion: connection.negotiatedProtocolVersion }
                    : {}),
                  capabilities: connection.capabilities,
                }).pipe(
                  Effect.zipRight(
                    ctx.onConnected(resolveMcpRuntimeNamespace(snapshot), server.instanceId),
                  ),
                )
              : Effect.void,
          ),
          Effect.zipRight(Deferred.succeed(deferred, connection)),
        ),
      onFailure: (cause) =>
        deleteFromMap(ctx.cells, key).pipe(
          Effect.zipRight(deleteFromMap(ctx.statuses, key)),
          Effect.zipRight(Deferred.failCause(deferred, cause)),
        ),
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
              [{ deferred, fresh: true }, new Map(current).set(key, { deferred })] as const,
          ),
        )
      },
    )
    if (decision.fresh) {
      yield* setStatus(ctx, key, baseStatus(snapshot, server))
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
    yield* deleteFromMap(ctx.statuses, key)
    yield* ctx.onClose(key)
    if (!cell) return
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
  return SynchronizedRef.get(ctx.statuses).pipe(
    Effect.map((current) =>
      [...current.entries()].flatMap(([key, status]) => (predicate(status, key) ? [key] : [])),
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
    const current = yield* SynchronizedRef.get(ctx.statuses)
    const idleNamespaces = new Set<string>()
    for (const status of current.values()) {
      if (!isActive(status.runtimeNamespace)) idleNamespaces.add(status.runtimeNamespace)
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
 * `SynchronizedRef`s; in-flight connects are deduplicated through a per-key
 * `Deferred` so concurrent turns share a single connection. The SDK connect
 * factory is the only Promise edge and is wrapped once via `Effect.tryPromise`.
 */
export function makeMcpRuntimeConnections(input: {
  readonly connect: McpConnectionFactory
  readonly onClose: (key: string) => Effect.Effect<void>
  readonly onConnected: (runtimeNamespace: string, serverInstanceId: string) => Effect.Effect<void>
}): Effect.Effect<McpRuntimeConnectionsService> {
  return Effect.gen(function* () {
    const cells = yield* SynchronizedRef.make(new Map<string, ConnectionCell>())
    const statuses = yield* SynchronizedRef.make(new Map<string, McpRuntimeConnectionStatus>())
    const ctx: ConnectionsCtx = { ...input, cells, statuses }
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
        SynchronizedRef.get(statuses).pipe(Effect.map((current) => [...current.values()])),
    }
  })
}
