import { randomBytes } from 'node:crypto'
import type { McpRuntimeNotice } from '@shared/types/mcp'
import { Effect, Ref } from 'effect'
import { resolveMcpRuntimeNamespace } from '../../../domain/mcp/runtime-namespace'
import { InMemoryMcpRemoteTaskStore, type McpRemoteTaskStore } from './remote-task-store'
import {
  discardSupersededSessionConnections,
  findHandle,
  getConnectionForServer,
  listRemoteTasks,
  loadCatalog,
  recordRemoteTasks,
} from './runtime-catalog'
import { makeMcpRuntimeConnections } from './runtime-connections'
import { clearSessionEvents, emptyMcpEventInboxState } from './runtime-event-inbox'
import { getEventSubscriptions, getEvents, setEventSubscription } from './runtime-events'
import { addNotice, getNotices, removeNotice } from './runtime-notices'
import type {
  ActiveEventSubscription,
  CatalogCacheEntry,
  CatalogTool,
  EventSubscriptionCell,
  EventSubscriptionLifecycleState,
  McpRuntimeStateService,
  RuntimeStateContext,
} from './runtime-state-types'
import type { McpConnectionFactory } from './types'

export type { CatalogTool, McpRuntimeStateService } from './runtime-state-types'

const HANDLE_KEY_BYTES = 32

function activateEventSubscriptionNamespace(ctx: RuntimeStateContext, runtimeNamespace: string) {
  return Ref.update(ctx.eventSubscriptionLifecycle, (current) => {
    const existing = current.namespaces.get(runtimeNamespace)
    if (existing?.active) return current
    const next = new Map(current.namespaces)
    next.set(runtimeNamespace, {
      active: true,
      generation: existing ? existing.generation + 1 : 0,
    })
    return { ...current, namespaces: next }
  })
}

function retireEventSubscriptionNamespace(ctx: RuntimeStateContext, runtimeNamespace: string) {
  return Ref.update(ctx.eventSubscriptionLifecycle, (current) => {
    const existing = current.namespaces.get(runtimeNamespace)
    const next = new Map(current.namespaces)
    next.set(runtimeNamespace, {
      active: false,
      generation: existing ? existing.generation + 1 : 0,
    })
    return { ...current, namespaces: next }
  })
}

function retireAllEventSubscriptionNamespaces(ctx: RuntimeStateContext) {
  return Ref.update(ctx.eventSubscriptionLifecycle, (current) => ({
    acceptUnknownNamespaces: false,
    namespaces: new Map(
      [...current.namespaces].map(([runtimeNamespace, entry]) => [
        runtimeNamespace,
        { active: false, generation: entry.generation + 1 },
      ]),
    ),
  }))
}

function retireEventSubscriptionCells(
  ctx: RuntimeStateContext,
  shouldRetire: (cell: EventSubscriptionCell) => boolean,
) {
  return Ref.modify(ctx.eventSubscriptionCells, (current) => {
    const retired: ActiveEventSubscription[] = []
    const next = new Map(current)
    for (const [key, cell] of current) {
      if (!shouldRetire(cell)) continue
      if (cell.active) retired.push(cell.active)
      if (cell.users === 0) next.delete(key)
      else next.set(key, { ...cell, generation: cell.generation + 1, active: undefined })
    }
    return [retired, next] as const
  })
}

function closeEventSubscriptions(
  subscriptions: readonly { readonly close: () => Promise<void> }[],
) {
  return Effect.forEach(
    subscriptions,
    (subscription) => Effect.promise(() => subscription.close().catch(() => undefined)),
    { discard: true },
  )
}

function invalidateSessionConnections(ctx: RuntimeStateContext, sessionId: string) {
  return ctx.connections.closeRuntimeNamespace(sessionId).pipe(
    Effect.zipRight(
      Ref.update(ctx.handles, (current) => {
        const next = new Map(current)
        for (const [handle, tool] of next) {
          if (tool.runtimeNamespace === sessionId) next.delete(handle)
        }
        return next
      }),
    ),
    Effect.zipRight(
      Ref.update(ctx.notices, (current) => {
        const next = new Map(current)
        next.delete(sessionId)
        return next
      }),
    ),
  )
}

function disposeSession(ctx: RuntimeStateContext, sessionId: string) {
  return Effect.gen(function* () {
    yield* retireEventSubscriptionNamespace(ctx, sessionId)
    const subscriptions = yield* retireEventSubscriptionCells(
      ctx,
      (cell) => cell.runtimeNamespace === sessionId,
    )
    yield* closeEventSubscriptions(subscriptions)
    yield* invalidateSessionConnections(ctx, sessionId)
    yield* clearSessionEvents(ctx, sessionId)
    yield* Effect.promise(() => ctx.remoteTasks.setDisabled({ sessionId, disabled: true }))
  })
}

function reconcileIdleConnections(
  ctx: RuntimeStateContext,
  isActive: (runtimeNamespace: string) => boolean,
) {
  return Effect.gen(function* () {
    const handleNamespaces = [...(yield* Ref.get(ctx.handles)).values()].map(
      (tool) => tool.runtimeNamespace,
    )
    const noticeNamespaces = [...(yield* Ref.get(ctx.notices)).keys()]
    const idleNamespaces = yield* ctx.connections.closeIdle(isActive, [
      ...noticeNamespaces,
      ...handleNamespaces,
    ])
    yield* Ref.update(ctx.handles, (current) => {
      const next = new Map(current)
      for (const [handle, tool] of next) {
        if (idleNamespaces.has(tool.runtimeNamespace)) next.delete(handle)
      }
      return next
    })
    yield* Ref.update(ctx.notices, (current) => {
      const next = new Map(current)
      for (const runtimeNamespace of idleNamespaces) next.delete(runtimeNamespace)
      return next
    })
  })
}

function disposeAll(ctx: RuntimeStateContext) {
  return Effect.gen(function* () {
    yield* retireAllEventSubscriptionNamespaces(ctx)
    const subscriptions = yield* retireEventSubscriptionCells(ctx, () => true)
    yield* closeEventSubscriptions(subscriptions)
    yield* ctx.connections.closeAll()
    yield* Ref.set(ctx.handles, new Map())
    yield* Ref.set(ctx.notices, new Map())
    yield* Ref.set(ctx.events, emptyMcpEventInboxState())
    yield* Effect.promise(() => ctx.remoteTasks.setAllDisabled())
  })
}

/**
 * Build the Effect-native MCP runtime state. All mutable coordination lives in
 * `Ref`s (see {@link RuntimeStateContext}); the connection pool is an Effect
 * service. Behaviour is decomposed across runtime-notices/catalog/events.
 */
export function makeMcpRuntimeState(input: {
  readonly connect: McpConnectionFactory
  readonly createHandleKey?: () => Buffer
  readonly remoteTaskStore?: McpRemoteTaskStore
}): Effect.Effect<McpRuntimeStateService> {
  return Effect.gen(function* () {
    const catalogs = yield* Ref.make(new Map<string, CatalogCacheEntry>())
    const handles = yield* Ref.make(new Map<string, CatalogTool>())
    const notices = yield* Ref.make(new Map<string, McpRuntimeNotice[]>())
    const eventSubscriptionCells = yield* Ref.make(new Map<string, EventSubscriptionCell>())
    const eventSubscriptionLifecycle = yield* Ref.make<EventSubscriptionLifecycleState>({
      acceptUnknownNamespaces: true,
      namespaces: new Map(),
    })
    const events = yield* Ref.make(emptyMcpEventInboxState())

    // The connection pool's teardown/connect callbacks touch state Refs directly
    // (the connection key doubles as the subscription/catalog key).
    const connections = yield* makeMcpRuntimeConnections({
      connect: input.connect,
      onClose: (key) =>
        Effect.gen(function* () {
          const subscription = yield* Ref.modify(eventSubscriptionCells, (current) => {
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
          yield* Ref.update(catalogs, (current) => {
            const next = new Map(current)
            next.delete(key)
            return next
          })
        }),
      onConnected: (runtimeNamespace, serverInstanceId) =>
        Ref.update(notices, (current) => {
          const existing = current.get(runtimeNamespace)
          if (!existing) return current
          const next = new Map(current)
          const filtered = existing.filter(
            (entry) => entry.id !== `runtime:${serverInstanceId}:connect`,
          )
          if (filtered.length === 0) next.delete(runtimeNamespace)
          else next.set(runtimeNamespace, filtered)
          return next
        }),
    })

    const ctx: RuntimeStateContext = {
      catalogs,
      handles,
      notices,
      eventSubscriptionCells,
      eventSubscriptionLifecycle,
      events,
      connections,
      remoteTasks: input.remoteTaskStore ?? new InMemoryMcpRemoteTaskStore(),
      handleKey: input.createHandleKey?.() ?? randomBytes(HANDLE_KEY_BYTES),
    }

    return {
      addNotice: (sessionId, notice) => addNotice(ctx, sessionId, notice),
      removeNotice: (sessionId, noticeId) => removeNotice(ctx, sessionId, noticeId),
      discardSupersededSessionConnections: (snapshot) =>
        activateEventSubscriptionNamespace(ctx, resolveMcpRuntimeNamespace(snapshot)).pipe(
          Effect.zipRight(discardSupersededSessionConnections(ctx, snapshot)),
        ),
      getConnectionForServer: (snapshot, serverInstanceId) =>
        getConnectionForServer(ctx, snapshot, serverInstanceId),
      loadCatalog: (snapshot, selectServer) => loadCatalog(ctx, snapshot, selectServer),
      findHandle: (snapshot, handle) => findHandle(ctx, snapshot, handle),
      recordRemoteTasks: (recordInput) => recordRemoteTasks(ctx, recordInput),
      listRemoteTasks: (listInput) => listRemoteTasks(ctx, listInput),
      setEventSubscription: (subscriptionInput) => setEventSubscription(ctx, subscriptionInput),
      getEvents: (sessionId) => getEvents(ctx, sessionId),
      getEventSubscriptions: (sessionId) => getEventSubscriptions(ctx, sessionId),
      invalidateSessionConnections: (sessionId) => invalidateSessionConnections(ctx, sessionId),
      disposeSession: (sessionId) => disposeSession(ctx, sessionId),
      reconcileIdleConnections: (isActive) => reconcileIdleConnections(ctx, isActive),
      disposeAll: () => disposeAll(ctx),
      getConnectionStatuses: () => connections.getStatuses(),
      getNotices: (sessionId) => getNotices(ctx, sessionId),
    } satisfies McpRuntimeStateService
  })
}
