import type { McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'
import { Deferred, Effect, SynchronizedRef } from 'effect'
import { resolveMcpRuntimeNamespace } from '../../../domain/mcp/runtime-namespace'
import { usageStatisticsMcpServerIdentifier } from '../../../domain/usage-statistics/usage-statistics-mcp'
import { type McpRuntimeFailure, toMcpRuntimeError } from '../../../ports/mcp-errors'
import { recordUsageStatistics } from '../../../usage-statistics/usage-statistics-recorder'
import type {
  ConnectionAttempt,
  ConnectionCell,
  ConnectionSlot,
  ConnectionsCtx,
} from './runtime-connection-slots'
import {
  mcpConnectedStatus,
  mcpConnectingStatus,
  mcpConnectionKey,
} from './runtime-connection-status'
import type { McpClientConnection } from './types'

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
    try: () => ctx.connect({ snapshot, server, signal: cell.abort.signal }),
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
              recordUsageStatistics({
                kind: 'mcp-server',
                identifier: usageStatisticsMcpServerIdentifier(server),
              })
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

/**
 * Starts (or joins) the connection for a server and returns the wait for it, without waiting.
 *
 * The connection slot exists once this returns, so a caller holding the runtime lifecycle lock
 * can hand the wait to a background fiber: a later close finds the slot and retires it rather
 * than the fiber opening a connection for a Session that has since been disposed.
 */
export function startConnection(
  ctx: ConnectionsCtx,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
): Effect.Effect<ConnectionAttempt> {
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
            const cell = {
              deferred,
              abort: new AbortController(),
              status: mcpConnectingStatus(snapshot, server),
            }
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
      return yield* startConnection(ctx, snapshot, server)
    }
    if (decision.fresh) {
      // The daemon always settles the shared Deferred if this caller is interrupted.
      yield* Effect.forkDaemon(runConnect(ctx, key, snapshot, server, decision.cell))
    }
    return {
      connection: Deferred.await(decision.cell.deferred),
      retired: decision.cell.abort.signal,
    } satisfies ConnectionAttempt
  })
}

export function getConnection(
  ctx: ConnectionsCtx,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
): Effect.Effect<McpClientConnection, McpRuntimeFailure> {
  return startConnection(ctx, snapshot, server).pipe(
    Effect.flatMap((attempt) => attempt.connection),
  )
}

/** Whether a connection is still the one its slot holds, so state learned from it still applies. */
export function isCurrentConnection(
  ctx: ConnectionsCtx,
  key: string,
  connection: McpClientConnection,
) {
  return SynchronizedRef.get(ctx.cells).pipe(
    Effect.map((current) => {
      const existing = current.get(key)
      return existing?.type === 'active' && existing.cell.connection === connection
    }),
  )
}
