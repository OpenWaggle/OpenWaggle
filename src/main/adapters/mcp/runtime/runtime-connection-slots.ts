import { Deferred, Effect, SynchronizedRef } from 'effect'
import type { McpRuntimeFailure } from '../../../ports/mcp-errors'
import type { McpRuntimeConnectionStatus } from '../../../ports/mcp-runtime-service'
import type { McpClientConnection, McpConnectionFactory } from './types'

/** A per-key Deferred with atomically coordinated connection status and lifetime. */
export interface ConnectionCell {
  readonly deferred: Deferred.Deferred<McpClientConnection, McpRuntimeFailure>
  readonly status: McpRuntimeConnectionStatus
  readonly connection?: McpClientConnection
}

export type ConnectionSlot =
  | { readonly type: 'active'; readonly cell: ConnectionCell }
  | {
      readonly type: 'closing'
      readonly cell: ConnectionCell
      readonly done: Deferred.Deferred<void>
    }

export interface ConnectionsCtx {
  readonly connect: McpConnectionFactory
  readonly onClose: (key: string) => Effect.Effect<void>
  readonly onConnected: (runtimeNamespace: string, serverInstanceId: string) => Effect.Effect<void>
  readonly cells: SynchronizedRef.SynchronizedRef<Map<string, ConnectionSlot>>
}

export function closeKey(
  ctx: ConnectionsCtx,
  key: string,
  expectedConnection?: McpClientConnection,
) {
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

export function matchingKeys(
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

export function closeKeys(ctx: ConnectionsCtx, keys: readonly string[]) {
  return Effect.forEach(keys, (key) => closeKey(ctx, key), { discard: true })
}

export function closeIdle(
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
