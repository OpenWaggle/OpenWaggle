import type { McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'
import { Deferred, Effect, SynchronizedRef } from 'effect'
import { resolveMcpRuntimeNamespace } from '../../../domain/mcp/runtime-namespace'
import { type McpRuntimeFailure, toMcpRuntimeError } from '../../../ports/mcp-errors'
import type { McpRuntimeConnectionStatus } from '../../../ports/mcp-runtime-service'
import {
  mcpConnectedStatus,
  mcpConnectingStatus,
  mcpConnectionKey,
} from './runtime-connection-status'
import type { McpClientConnection, McpConnectionFactory } from './types'

/** A per-key Deferred with atomically coordinated connection status and lifetime. */
interface ConnectionCell {
  readonly deferred: Deferred.Deferred<McpClientConnection, McpRuntimeFailure>
  readonly status: McpRuntimeConnectionStatus
  readonly connection?: McpClientConnection
}

type ConnectionSlot =
  | { readonly type: 'active'; readonly cell: ConnectionCell }
  | {
      readonly type: 'closing'
      readonly cell: ConnectionCell
      readonly done: Deferred.Deferred<void>
    }

interface ConnectionsCtx {
  readonly connect: McpConnectionFactory
  readonly onClose: (key: string) => Effect.Effect<void>
  readonly onConnected: (runtimeNamespace: string, serverInstanceId: string) => Effect.Effect<void>
  readonly cells: SynchronizedRef.SynchronizedRef<Map<string, ConnectionSlot>>
}

export interface McpRuntimeConnectionsService {
  key(snapshot: McpTurnSnapshot, server: McpTurnSnapshotServer): string
  get(
    snapshot: McpTurnSnapshot,
    server: McpTurnSnapshotServer,
  ): Effect.Effect<McpClientConnection, McpRuntimeFailure>
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
function removeCell(ctx: ConnectionsCtx, key: string, deferred: ConnectionCell['deferred']) {
  return SynchronizedRef.update(ctx.cells, (current) => {
    const existing = current.get(key)
    if (existing?.type !== 'active' || existing.cell.deferred !== deferred) return current
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
  cell: ConnectionCell,
) {
  return Effect.tryPromise({
    try: () => ctx.connect({ snapshot, server }),
    catch: (error) => toMcpRuntimeError('connect', error),
  }).pipe(
    Effect.matchCauseEffect({
      onSuccess: (connection) =>
        // Publish status only while this exact cell is still current.
        SynchronizedRef.modify(ctx.cells, (current) => {
          const existing = current.get(key)
          if (existing?.type !== 'active' || existing.cell.deferred !== cell.deferred) {
            return [false, current] as const
          }
          return [
            true,
            new Map(current).set(key, {
              type: 'active',
              cell: {
                ...existing.cell,
                connection,
                status: mcpConnectedStatus(snapshot, server, connection),
              },
            }),
          ] as const
        }).pipe(
          Effect.flatMap((current) => {
            if (current) {
              return ctx
                .onConnected(resolveMcpRuntimeNamespace(snapshot), server.instanceId)
                .pipe(Effect.zipRight(Deferred.succeed(cell.deferred, connection)))
            }
            const retired = toMcpRuntimeError(
              'connect',
              new Error('MCP connection was retired before it became ready.'),
            )
            return Effect.promise(() => connection.close().catch(() => undefined)).pipe(
              Effect.zipRight(Deferred.fail(cell.deferred, retired)),
            )
          }),
        ),
      onFailure: (cause) =>
        // Drop only this failed cell; an older connector must never delete a replacement.
        removeCell(ctx, key, cell.deferred).pipe(
          Effect.zipRight(Deferred.failCause(cell.deferred, cause)),
        ),
    }),
  )
}

function getConnection(
  ctx: ConnectionsCtx,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
): Effect.Effect<McpClientConnection, McpRuntimeFailure> {
  return Effect.gen(function* () {
    const key = mcpConnectionKey(snapshot, server)
    type Decision =
      | { readonly type: 'active'; readonly cell: ConnectionCell; readonly fresh: boolean }
      | { readonly type: 'closing'; readonly done: Deferred.Deferred<void> }
    const decision = yield* SynchronizedRef.modifyEffect(
      ctx.cells,
      (current): Effect.Effect<readonly [Decision, Map<string, ConnectionSlot>]> => {
        const existing = current.get(key)
        if (existing?.type === 'active') {
          return Effect.succeed([
            { type: 'active', cell: existing.cell, fresh: false },
            current,
          ] as const)
        }
        if (existing?.type === 'closing') {
          return Effect.succeed([{ type: 'closing', done: existing.done }, current] as const)
        }
        return Deferred.make<McpClientConnection, McpRuntimeFailure>().pipe(
          Effect.map((deferred) => {
            const cell = { deferred, status: mcpConnectingStatus(snapshot, server) }
            return [
              { type: 'active', cell, fresh: true },
              new Map(current).set(key, { type: 'active', cell }),
            ] as const
          }),
        )
      },
    )
    if (decision.type === 'closing') {
      yield* Deferred.await(decision.done)
      return yield* getConnection(ctx, snapshot, server)
    }
    if (decision.fresh) {
      // The daemon always settles the shared Deferred if this caller is interrupted.
      yield* Effect.forkDaemon(runConnect(ctx, key, snapshot, server, decision.cell))
    }
    return yield* Deferred.await(decision.cell.deferred)
  })
}

function closeKey(ctx: ConnectionsCtx, key: string, expectedConnection?: McpClientConnection) {
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      type CloseDecision =
        | { readonly type: 'missing' }
        | { readonly type: 'waiting'; readonly done: Deferred.Deferred<void> }
        | {
            readonly type: 'owner'
            readonly cell: ConnectionCell
            readonly done: Deferred.Deferred<void>
          }
      const decision = yield* SynchronizedRef.modifyEffect(
        ctx.cells,
        (current): Effect.Effect<readonly [CloseDecision, Map<string, ConnectionSlot>]> => {
          const existing = current.get(key)
          if (
            !existing ||
            (expectedConnection && existing.cell.connection !== expectedConnection)
          ) {
            return Effect.succeed([{ type: 'missing' }, current] as const)
          }
          if (existing.type === 'closing') {
            return Effect.succeed([{ type: 'waiting', done: existing.done }, current] as const)
          }
          return Deferred.make<void>().pipe(
            Effect.map(
              (done) =>
                [
                  { type: 'owner', cell: existing.cell, done },
                  new Map(current).set(key, { type: 'closing', cell: existing.cell, done }),
                ] as const,
            ),
          )
        },
      )
      if (decision.type === 'missing') return
      if (decision.type === 'waiting') return yield* restore(Deferred.await(decision.done))

      const finish = SynchronizedRef.update(ctx.cells, (current) => {
        const existing = current.get(key)
        if (existing?.type !== 'closing' || existing.done !== decision.done) return current
        const next = new Map(current)
        next.delete(key)
        return next
      }).pipe(Effect.zipRight(Deferred.succeed(decision.done, undefined)), Effect.asVoid)

      const cleanup = ctx.onClose(key).pipe(
        Effect.zipRight(
          Deferred.await(decision.cell.deferred).pipe(
            Effect.matchCauseEffect({
              onSuccess: (connection) =>
                Effect.promise(() => connection.close().catch(() => undefined)),
              onFailure: () => Effect.void,
            }),
          ),
        ),
        Effect.ensuring(finish),
      )
      // Keep the tombstone until cleanup settles, even if its caller is cancelled.
      yield* Effect.forkDaemon(cleanup)
      yield* restore(Deferred.await(decision.done))
    }),
  )
}

function matchingKeys(
  ctx: ConnectionsCtx,
  predicate: (status: McpRuntimeConnectionStatus, key: string) => boolean,
) {
  return SynchronizedRef.get(ctx.cells).pipe(
    Effect.map((current) =>
      [...current.entries()].flatMap(([key, slot]) =>
        predicate(slot.cell.status, key) ? [key] : [],
      ),
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
    for (const slot of current.values()) {
      if (!isActive(slot.cell.status.runtimeNamespace)) {
        idleNamespaces.add(slot.cell.status.runtimeNamespace)
      }
    }
    for (const runtimeNamespace of additionalNamespaces) {
      if (!isActive(runtimeNamespace)) idleNamespaces.add(runtimeNamespace)
    }
    const keys = yield* matchingKeys(ctx, (status) => idleNamespaces.has(status.runtimeNamespace))
    yield* closeKeys(ctx, keys)
    return idleNamespaces
  })
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
