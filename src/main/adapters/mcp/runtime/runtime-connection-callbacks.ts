import type { McpRuntimeNotice } from '@shared/types/mcp'
import { Effect, Ref } from 'effect'
import type { CatalogCacheEntry, EventSubscriptionCell } from './runtime-state-types'
import { connectFailureKey } from './runtime-tool-catalog-state'

/**
 * Releases what a closed connection slot held: its event subscription, its fresh catalog, and
 * the mark that its listings may not be remembered (the slot's key can be reused by a new
 * connection, which starts with current credentials).
 */
export function connectionClosed(
  refs: {
    readonly eventSubscriptionCells: Ref.Ref<Map<string, EventSubscriptionCell>>
    readonly catalogs: Ref.Ref<Map<string, CatalogCacheEntry>>
    readonly forgottenConnections: Ref.Ref<ReadonlySet<string>>
  },
  key: string,
) {
  return Effect.gen(function* () {
    const subscription = yield* Ref.modify(refs.eventSubscriptionCells, (current) => {
      const existing = current.get(key)
      if (!existing) return [undefined, current] as const
      const next = new Map(current)
      if (existing.users === 0) next.delete(key)
      else {
        next.set(key, {
          ...existing,
          generation: existing.generation + 1,
          active: undefined,
        })
      }
      return [existing.active, next] as const
    })
    if (subscription) yield* Effect.promise(() => subscription.close().catch(() => undefined))
    yield* Ref.update(refs.catalogs, (current) => {
      const next = new Map(current)
      next.delete(key)
      return next
    })
    yield* Ref.update(refs.forgottenConnections, (current) => {
      if (!current.has(key)) return current
      const next = new Set(current)
      next.delete(key)
      return next
    })
  })
}

/** Clears a server's connect notice and its recorded failure once it has connected. */
export function connectionOpened(
  refs: {
    readonly notices: Ref.Ref<Map<string, McpRuntimeNotice[]>>
    readonly connectFailures: Ref.Ref<ReadonlyMap<string, string>>
  },
  runtimeNamespace: string,
  serverInstanceId: string,
) {
  return Ref.update(refs.notices, (current) => {
    const existing = current.get(runtimeNamespace)
    if (!existing) return current
    const next = new Map(current)
    const filtered = existing.filter((entry) => entry.id !== `runtime:${serverInstanceId}:connect`)
    if (filtered.length === 0) next.delete(runtimeNamespace)
    else next.set(runtimeNamespace, filtered)
    return next
  }).pipe(
    Effect.zipRight(
      Ref.update(refs.connectFailures, (current) => {
        const key = connectFailureKey(runtimeNamespace, serverInstanceId)
        if (!current.has(key)) return current
        const next = new Map(current)
        next.delete(key)
        return next
      }),
    ),
  )
}
