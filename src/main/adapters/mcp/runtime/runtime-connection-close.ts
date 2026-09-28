import { Deferred, Effect, SynchronizedRef } from 'effect'
import type { McpRuntimeConnectionStatus } from '../../../ports/mcp-runtime-service'
import type { ConnectionCell, ConnectionSlot, ConnectionsCtx } from './runtime-connection-slots'
import type { McpClientConnection } from './types'

/**
 * Closes one slot. A lifecycle writer does not wait for an aborted connect to settle; a shutdown
 * passes `settle` and waits until the server's process is gone, or the app would exit while a
 * server that was still starting runs on.
 */
export function closeKey(
  ctx: ConnectionsCtx,
  key: string,
  options: { readonly expectedConnection?: McpClientConnection; readonly settle?: boolean } = {},
) {
  const { expectedConnection, settle = false } = options
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      type CloseDecision =
        | { readonly type: 'missing' }
        | {
            readonly type: 'waiting'
            readonly done: Deferred.Deferred<void>
            readonly connecting: boolean
          }
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
            return Effect.succeed([
              {
                type: 'waiting',
                done: existing.done,
                connecting: existing.cell.connection === undefined,
              },
              current,
            ] as const)
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
      if (decision.type === 'waiting') {
        // Another close owns the tombstone; one still connecting is not worth waiting out.
        return decision.connecting && !settle
          ? undefined
          : yield* restore(Deferred.await(decision.done))
      }
      // A connect still in progress is cancelled. The caller waits only for the slot's state to be
      // released, not for the cancelled connect to settle: lifecycle writers hold the Host-wide
      // lock while they close, and a slow server must not hold every Session behind it.
      decision.cell.abort.abort()
      const connecting = decision.cell.connection === undefined
      const released = yield* Deferred.make<void>()

      const finish = SynchronizedRef.update(ctx.cells, (current) => {
        const existing = current.get(key)
        if (existing?.type !== 'closing' || existing.done !== decision.done) return current
        const next = new Map(current)
        next.delete(key)
        return next
      }).pipe(Effect.zipRight(Deferred.succeed(decision.done, undefined)), Effect.asVoid)

      const cleanup = ctx.onClose(key).pipe(
        Effect.ensuring(Deferred.succeed(released, undefined)),
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
      // Keep the tombstone until cleanup settles, even if its caller is cancelled. A new connect
      // for the same key still waits for it, so two processes never serve one slot.
      yield* Effect.forkDaemon(cleanup)
      yield* restore(Deferred.await(connecting && !settle ? released : decision.done))
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

export function closeKeys(
  ctx: ConnectionsCtx,
  keys: readonly string[],
  options: { readonly settle?: boolean } = {},
) {
  return Effect.forEach(keys, (key) => closeKey(ctx, key, options), { discard: true })
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
