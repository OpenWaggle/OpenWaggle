import type {
  McpEventRecord,
  McpEventSubscriptionState,
  McpJsonValue,
  McpRuntimeNotice,
  McpTaskRecord,
  McpTurnSnapshot,
  McpTurnSnapshotServer,
} from '@shared/types/mcp'
import type { Deferred, Effect, Ref, SynchronizedRef } from 'effect'
import type {
  McpRuntimeFailure,
  McpServerNotEnabled,
  McpStaleToolHandle,
} from '../../../ports/mcp-errors'
import type {
  McpDirectToolListOptions,
  McpRuntimeConnectionStatus,
} from '../../../ports/mcp-runtime-service'
import type { McpRemoteTaskStore } from './remote-task-store'
import type { McpRuntimeConnectionsService } from './runtime-connections'
import type { McpToolCatalogCache } from './tool-catalog-cache'
import type { McpClientConnection, McpRuntimeTool } from './types'

/**
 * A tool resolved from a server catalog, addressable by an opaque handle.
 *
 * `live` tools were listed by the Session's own connection. `cached` tools came from the tool
 * list cache while that connection was still starting; using one waits for the connection and
 * checks the live tool still matches (see `resolveToolHandle`).
 */
export interface CatalogTool {
  readonly handle: string
  readonly server: McpTurnSnapshotServer
  readonly tool: McpRuntimeTool
  readonly snapshotRevision: string
  readonly runtimeNamespace: string
  readonly source: 'live' | 'cached'
}

/** A listing of one server's tools in flight for a Session, shared by everyone who needs it. */
export interface ServerListing {
  readonly result: Deferred.Deferred<readonly CatalogTool[], McpRuntimeFailure>
  /** Fires when the listing's connection slot was closed, so its failure is not a real one. */
  readonly retired: AbortSignal
}

export interface CatalogCacheEntry {
  readonly expiresAt: number
  readonly tools: readonly CatalogTool[]
}

export interface ActiveEventSubscription {
  readonly sessionId: string
  readonly state: McpEventSubscriptionState
  readonly close: () => Promise<void>
}

export interface EventSubscriptionCell {
  readonly semaphore: Effect.Semaphore
  readonly users: number
  readonly generation: number
  readonly runtimeNamespace: string
  readonly active: ActiveEventSubscription | undefined
}

export interface EventSubscriptionLifecycleState {
  readonly acceptUnknownNamespaces: boolean
  readonly namespaces: Map<string, { readonly active: boolean; readonly generation: number }>
}

export interface RetainedMcpEvent {
  readonly record: McpEventRecord
  readonly bytes: number
}

export interface McpEventInboxState {
  readonly bySession: Map<string, readonly RetainedMcpEvent[]>
  readonly sessionBytes: Map<string, number>
  readonly insertionOrder: Map<string, { readonly sessionId: string; readonly bytes: number }>
  readonly retainedBytes: number
}

/**
 * Shared mutable context for the Effect-native runtime state. All coordination
 * lives in these `Ref`s; the connection pool is an Effect service and the
 * remote-task store is the Promise persistence edge.
 */
export interface RuntimeStateContext {
  readonly catalogs: Ref.Ref<Map<string, CatalogCacheEntry>>
  readonly listings: SynchronizedRef.SynchronizedRef<Map<string, ServerListing>>
  readonly handles: Ref.Ref<Map<string, CatalogTool>>
  readonly notices: Ref.Ref<Map<string, McpRuntimeNotice[]>>
  readonly eventSubscriptionCells: Ref.Ref<Map<string, EventSubscriptionCell>>
  readonly eventSubscriptionLifecycle: Ref.Ref<EventSubscriptionLifecycleState>
  readonly events: Ref.Ref<McpEventInboxState>
  readonly connections: McpRuntimeConnectionsService
  readonly remoteTasks: McpRemoteTaskStore
  readonly toolCatalogCache: McpToolCatalogCache
  readonly optionalStartupGraceMs: number
  readonly handleKey: Buffer
}

export interface McpRuntimeStateService {
  addNotice(sessionId: string, notice: McpRuntimeNotice): Effect.Effect<void>
  removeNotice(sessionId: string, noticeId: string): Effect.Effect<void>
  discardSupersededSessionConnections(snapshot: McpTurnSnapshot): Effect.Effect<void>
  getConnectionForServer(
    snapshot: McpTurnSnapshot,
    serverInstanceId: string,
  ): Effect.Effect<
    { readonly server: McpTurnSnapshotServer; readonly connection: McpClientConnection },
    McpServerNotEnabled | McpRuntimeFailure
  >
  loadCatalog(
    snapshot: McpTurnSnapshot,
    selectServer?: (server: McpTurnSnapshotServer) => boolean,
  ): Effect.Effect<readonly CatalogTool[], McpRuntimeFailure>
  /** The direct tools a turn registers with Pi; see `loadDirectToolCatalog`. */
  loadDirectToolCatalog(
    snapshot: McpTurnSnapshot,
    options?: McpDirectToolListOptions,
  ): Effect.Effect<readonly CatalogTool[], McpRuntimeFailure>
  findHandle(
    snapshot: McpTurnSnapshot,
    handle: string,
  ): Effect.Effect<CatalogTool, McpStaleToolHandle>
  /** A handle's live tool, waiting for its server when the handle came from the cache. */
  resolveHandle(
    snapshot: McpTurnSnapshot,
    handle: string,
  ): Effect.Effect<CatalogTool, McpRuntimeFailure>
  recordRemoteTasks(input: {
    readonly snapshot: McpTurnSnapshot
    readonly server: McpTurnSnapshotServer
    readonly connection: McpClientConnection
    readonly tasks: readonly McpJsonValue[]
  }): Effect.Effect<readonly McpTaskRecord[]>
  listRemoteTasks(
    input?: Parameters<McpRemoteTaskStore['list']>[0],
  ): Effect.Effect<readonly McpTaskRecord[]>
  setEventSubscription(input: {
    readonly snapshot: McpTurnSnapshot
    readonly serverInstanceId: string
    readonly enabled: boolean
    readonly resourceUris: readonly string[]
  }): Effect.Effect<McpEventSubscriptionState, McpRuntimeFailure>
  getEvents(sessionId?: string | null): Effect.Effect<readonly McpEventRecord[]>
  getEventSubscriptions(
    sessionId?: string | null,
  ): Effect.Effect<readonly McpEventSubscriptionState[]>
  forgetToolCatalog(serverInstanceId: string): Effect.Effect<void>
  invalidateSessionConnections(sessionId: string): Effect.Effect<void>
  disposeSession(sessionId: string): Effect.Effect<void>
  reconcileIdleConnections(isActive: (runtimeNamespace: string) => boolean): Effect.Effect<void>
  disposeAll(): Effect.Effect<void>
  getConnectionStatuses(): Effect.Effect<readonly McpRuntimeConnectionStatus[]>
  getNotices(sessionId?: string | null): Effect.Effect<readonly McpRuntimeNotice[]>
}
