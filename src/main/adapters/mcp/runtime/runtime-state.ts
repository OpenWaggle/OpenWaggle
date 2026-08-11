import { randomBytes } from 'node:crypto'
import type { McpEventRecord, McpRuntimeNotice } from '@shared/types/mcp'
import { Effect, Ref } from 'effect'
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
import { getEventSubscriptions, getEvents, setEventSubscription } from './runtime-events'
import { addNotice, getNotices, removeNotice } from './runtime-notices'
import type {
  ActiveEventSubscription,
  CatalogCacheEntry,
  CatalogTool,
  McpRuntimeStateService,
  RuntimeStateContext,
} from './runtime-state-types'
import type { McpConnectionFactory } from './types'

export type { CatalogTool, McpRuntimeStateService } from './runtime-state-types'

const HANDLE_KEY_BYTES = 32

function disposeSession(ctx: RuntimeStateContext, sessionId: string) {
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
    Effect.zipRight(
      Effect.promise(() => ctx.remoteTasks.setDisabled({ sessionId, disabled: true })),
    ),
  )
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
  return ctx.connections
    .closeAll()
    .pipe(
      Effect.zipRight(Ref.set(ctx.handles, new Map())),
      Effect.zipRight(Ref.set(ctx.notices, new Map())),
      Effect.zipRight(Ref.set(ctx.events, new Map())),
      Effect.zipRight(Effect.promise(() => ctx.remoteTasks.setAllDisabled())),
    )
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
    const eventSubscriptions = yield* Ref.make(new Map<string, ActiveEventSubscription>())
    const events = yield* Ref.make(new Map<string, McpEventRecord[]>())

    // The connection pool's teardown/connect callbacks touch state Refs directly
    // (the connection key doubles as the subscription/catalog key).
    const connections = yield* makeMcpRuntimeConnections({
      connect: input.connect,
      onClose: (key) =>
        Effect.gen(function* () {
          const subscription = (yield* Ref.get(eventSubscriptions)).get(key)
          yield* Ref.update(eventSubscriptions, (current) => {
            const next = new Map(current)
            next.delete(key)
            return next
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
      eventSubscriptions,
      events,
      connections,
      remoteTasks: input.remoteTaskStore ?? new InMemoryMcpRemoteTaskStore(),
      handleKey: input.createHandleKey?.() ?? randomBytes(HANDLE_KEY_BYTES),
    }

    return {
      addNotice: (sessionId, notice) => addNotice(ctx, sessionId, notice),
      removeNotice: (sessionId, noticeId) => removeNotice(ctx, sessionId, noticeId),
      discardSupersededSessionConnections: (snapshot) =>
        discardSupersededSessionConnections(ctx, snapshot),
      getConnectionForServer: (snapshot, serverInstanceId) =>
        getConnectionForServer(ctx, snapshot, serverInstanceId),
      loadCatalog: (snapshot, selectServer) => loadCatalog(ctx, snapshot, selectServer),
      findHandle: (snapshot, handle) => findHandle(ctx, snapshot, handle),
      recordRemoteTasks: (recordInput) => recordRemoteTasks(ctx, recordInput),
      listRemoteTasks: (listInput) => listRemoteTasks(ctx, listInput),
      setEventSubscription: (subscriptionInput) => setEventSubscription(ctx, subscriptionInput),
      getEvents: (sessionId) => getEvents(ctx, sessionId),
      getEventSubscriptions: (sessionId) => getEventSubscriptions(ctx, sessionId),
      disposeSession: (sessionId) => disposeSession(ctx, sessionId),
      reconcileIdleConnections: (isActive) => reconcileIdleConnections(ctx, isActive),
      disposeAll: () => disposeAll(ctx),
      getConnectionStatuses: () => connections.getStatuses(),
      getNotices: (sessionId) => getNotices(ctx, sessionId),
    } satisfies McpRuntimeStateService
  })
}
