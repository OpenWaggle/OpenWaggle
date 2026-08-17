import type {
  McpEventRecord,
  McpEventSubscriptionState,
  McpJsonValue,
  McpRuntimeNotice,
  McpTaskRecord,
  McpTurnSnapshot,
  McpTurnSnapshotServer,
} from '@shared/types/mcp'
import type { Effect, Ref } from 'effect'
import type {
  McpRuntimeFailure,
  McpServerNotEnabled,
  McpStaleToolHandle,
} from '../../../ports/mcp-errors'
import type { McpRuntimeConnectionStatus } from '../../../ports/mcp-runtime-service'
import type { McpRemoteTaskStore } from './remote-task-store'
import type { McpRuntimeConnectionsService } from './runtime-connections'
import type { McpClientConnection, McpRuntimeTool } from './types'

/** A tool resolved from a server catalog, addressable by an opaque handle. */
export interface CatalogTool {
  readonly handle: string
  readonly server: McpTurnSnapshotServer
  readonly connection: McpClientConnection
  readonly tool: McpRuntimeTool
  readonly snapshotRevision: string
  readonly runtimeNamespace: string
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

/**
 * Shared mutable context for the Effect-native runtime state. All coordination
 * lives in these `Ref`s; the connection pool is an Effect service and the
 * remote-task store is the Promise persistence edge.
 */
export interface RuntimeStateContext {
  readonly catalogs: Ref.Ref<Map<string, CatalogCacheEntry>>
  readonly handles: Ref.Ref<Map<string, CatalogTool>>
  readonly notices: Ref.Ref<Map<string, McpRuntimeNotice[]>>
  readonly eventSubscriptions: Ref.Ref<Map<string, ActiveEventSubscription>>
  readonly events: Ref.Ref<Map<string, McpEventRecord[]>>
  readonly connections: McpRuntimeConnectionsService
  readonly remoteTasks: McpRemoteTaskStore
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
  findHandle(
    snapshot: McpTurnSnapshot,
    handle: string,
  ): Effect.Effect<CatalogTool, McpStaleToolHandle>
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
  disposeSession(sessionId: string): Effect.Effect<void>
  reconcileIdleConnections(isActive: (runtimeNamespace: string) => boolean): Effect.Effect<void>
  disposeAll(): Effect.Effect<void>
  getConnectionStatuses(): Effect.Effect<readonly McpRuntimeConnectionStatus[]>
  getNotices(sessionId?: string | null): Effect.Effect<readonly McpRuntimeNotice[]>
}
