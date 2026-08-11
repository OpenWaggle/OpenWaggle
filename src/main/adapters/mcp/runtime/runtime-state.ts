import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { MCP_CONFIG } from '@shared/constants/mcp'
import type {
  McpEventRecord,
  McpEventSubscriptionState,
  McpJsonValue,
  McpRuntimeNotice,
  McpTurnSnapshot,
  McpTurnSnapshotServer,
} from '@shared/types/mcp'
import { resolveMcpRuntimeNamespace } from '../../../domain/mcp/runtime-namespace'
import { createRemoteTaskRecords } from './remote-task-records'
import { InMemoryMcpRemoteTaskStore, type McpRemoteTaskStore } from './remote-task-store'
import { McpRuntimeConnections } from './runtime-connections'
import type { McpClientConnection, McpConnectionFactory, McpRuntimeTool } from './types'

const HANDLE_KEY_BYTES = 32
const HANDLE_LENGTH = 24

export interface CatalogTool {
  readonly handle: string
  readonly server: McpTurnSnapshotServer
  readonly connection: McpClientConnection
  readonly tool: McpRuntimeTool
  readonly snapshotRevision: string
  readonly runtimeNamespace: string
}

interface CatalogCacheEntry {
  readonly expiresAt: number
  readonly tools: readonly CatalogTool[]
}

interface ActiveEventSubscription {
  readonly sessionId: string
  readonly state: McpEventSubscriptionState
  close(): Promise<void>
}

export class McpRuntimeState {
  private readonly handleKey: Buffer
  private readonly now: () => number
  private readonly connections: McpRuntimeConnections
  private readonly catalogs = new Map<string, CatalogCacheEntry>()
  private readonly handles = new Map<string, CatalogTool>()
  private readonly notices = new Map<string, McpRuntimeNotice[]>()
  private readonly eventSubscriptions = new Map<string, ActiveEventSubscription>()
  private readonly events = new Map<string, McpEventRecord[]>()
  private readonly remoteTasks: McpRemoteTaskStore

  constructor(
    private readonly connect: McpConnectionFactory,
    options: {
      readonly createHandleKey?: () => Buffer
      readonly now?: () => number
      readonly remoteTaskStore?: McpRemoteTaskStore
    },
  ) {
    this.handleKey = options.createHandleKey?.() ?? randomBytes(HANDLE_KEY_BYTES)
    this.now = options.now ?? Date.now
    this.remoteTasks = options.remoteTaskStore ?? new InMemoryMcpRemoteTaskStore()
    this.connections = new McpRuntimeConnections(
      this.connect,
      async (key) => {
        const subscription = this.eventSubscriptions.get(key)
        this.eventSubscriptions.delete(key)
        await subscription?.close().catch(() => undefined)
        this.catalogs.delete(key)
      },
      (runtimeNamespace, serverInstanceId) =>
        this.removeNotice(runtimeNamespace, `runtime:${serverInstanceId}:connect`),
    )
  }

  addNotice(sessionId: string, notice: McpRuntimeNotice) {
    const current = this.notices.get(sessionId) ?? []
    this.notices.set(sessionId, [...current.filter((entry) => entry.id !== notice.id), notice])
  }

  removeNotice(sessionId: string, noticeId: string) {
    const current = this.notices.get(sessionId)
    if (!current) return
    const next = current.filter((entry) => entry.id !== noticeId)
    if (next.length === 0) this.notices.delete(sessionId)
    else this.notices.set(sessionId, next)
  }

  private makeHandle(snapshot: McpTurnSnapshot, server: McpTurnSnapshotServer, toolName: string) {
    const runtimeNamespace = resolveMcpRuntimeNamespace(snapshot)
    return `mcp_${createHmac('sha256', this.handleKey)
      .update(`${runtimeNamespace}\0${snapshot.revision}\0${server.instanceId}\0${toolName}`)
      .digest('base64url')
      .slice(0, HANDLE_LENGTH)}`
  }

  async discardSupersededSessionConnections(snapshot: McpTurnSnapshot) {
    const runtimeNamespace = resolveMcpRuntimeNamespace(snapshot)
    await this.connections.closeSuperseded(runtimeNamespace, snapshot.revision)
    for (const [handle, tool] of this.handles) {
      if (
        tool.runtimeNamespace === runtimeNamespace &&
        tool.snapshotRevision !== snapshot.revision
      ) {
        this.handles.delete(handle)
      }
    }
    await this.remoteTasks.setDisabled({
      sessionId: snapshot.sessionId,
      enabledServers: snapshot.servers.map((server) => ({
        instanceId: server.instanceId,
        configHash: server.configHash,
      })),
      disabled: false,
    })
  }

  async getConnectionForServer(snapshot: McpTurnSnapshot, serverInstanceId: string) {
    const server = snapshot.servers.find((candidate) => candidate.instanceId === serverInstanceId)
    if (!server) throw new Error('The requested MCP server is not enabled in this turn snapshot.')
    return { server, connection: await this.connections.get(snapshot, server) }
  }

  private async loadServerCatalog(snapshot: McpTurnSnapshot, server: McpTurnSnapshotServer) {
    const key = this.connections.key(snapshot, server)
    const cached = this.catalogs.get(key)
    if (cached && cached.expiresAt > this.now()) return cached.tools
    const connection = await this.connections.get(snapshot, server)
    const listedTools = await connection.listTools()
    const tools = listedTools.map((tool) => {
      const runtimeNamespace = resolveMcpRuntimeNamespace(snapshot)
      const catalogTool: CatalogTool = {
        handle: this.makeHandle(snapshot, server, tool.name),
        server,
        connection,
        tool,
        snapshotRevision: snapshot.revision,
        runtimeNamespace,
      }
      this.handles.set(catalogTool.handle, catalogTool)
      return catalogTool
    })
    this.catalogs.set(key, { expiresAt: this.now() + MCP_CONFIG.CATALOG_CACHE_TTL_MS, tools })
    return tools
  }

  async loadCatalog(
    snapshot: McpTurnSnapshot,
    selectServer: (server: McpTurnSnapshotServer) => boolean = () => true,
  ) {
    await this.discardSupersededSessionConnections(snapshot)
    const selectedServers = snapshot.servers.filter(selectServer)
    const results = await Promise.allSettled(
      selectedServers.map((server) => this.loadServerCatalog(snapshot, server)),
    )
    const tools: CatalogTool[] = []
    for (const [index, result] of results.entries()) {
      const server = selectedServers[index]
      if (!server) continue
      if (result.status === 'fulfilled') {
        tools.push(...result.value)
        continue
      }
      const detail = result.reason instanceof Error ? result.reason.message : String(result.reason)
      this.addNotice(resolveMcpRuntimeNamespace(snapshot), {
        id: `runtime:${server.instanceId}:connect`,
        severity: server.definition.required ? 'error' : 'warning',
        title: `${server.name} MCP server could not connect`,
        detail,
        action: 'Run MCP doctor, review the server configuration, then retry the turn.',
        serverInstanceId: server.instanceId,
      })
      if (server.definition.required) {
        throw new Error(`Required MCP server ${server.name} could not connect: ${detail}`)
      }
    }
    return tools
  }

  findHandle(snapshot: McpTurnSnapshot, handle: string) {
    const tool = this.handles.get(handle)
    if (
      !tool ||
      tool.runtimeNamespace !== resolveMcpRuntimeNamespace(snapshot) ||
      tool.snapshotRevision !== snapshot.revision
    ) {
      throw new Error('Unknown or stale MCP tool handle. Search or list tools again.')
    }
    return tool
  }

  async recordRemoteTasks(input: {
    readonly snapshot: McpTurnSnapshot
    readonly server: McpTurnSnapshotServer
    readonly connection: McpClientConnection
    readonly tasks: readonly McpJsonValue[]
  }) {
    const records = createRemoteTaskRecords({ ...input, now: this.now })
    return this.remoteTasks.upsert(records)
  }

  listRemoteTasks(input?: Parameters<McpRemoteTaskStore['list']>[0]) {
    return this.remoteTasks.list(input)
  }

  private addEvent(
    snapshot: McpTurnSnapshot,
    server: McpTurnSnapshotServer,
    event: Parameters<Parameters<McpClientConnection['subscribeEvents']>[0]['onEvent']>[0],
  ) {
    const current = this.events.get(snapshot.sessionId) ?? []
    const next: McpEventRecord = {
      id: randomUUID(),
      sessionId: snapshot.sessionId,
      serverInstanceId: server.instanceId,
      serverLabel: server.name,
      kind: event.kind,
      receivedAt: this.now(),
      payload: event.payload,
      read: false,
    }
    this.events.set(snapshot.sessionId, [...current, next].slice(-MCP_CONFIG.MAX_EVENT_INBOX_ITEMS))
  }

  async setEventSubscription(input: {
    readonly snapshot: McpTurnSnapshot
    readonly serverInstanceId: string
    readonly enabled: boolean
    readonly resourceUris: readonly string[]
  }): Promise<McpEventSubscriptionState> {
    const server = input.snapshot.servers.find(
      (candidate) => candidate.instanceId === input.serverInstanceId,
    )
    if (!server) throw new Error('The requested MCP server is not enabled in this turn snapshot.')
    const key = this.connections.key(input.snapshot, server)
    const current = this.eventSubscriptions.get(key)
    if (current) {
      this.eventSubscriptions.delete(key)
      await current.close()
    }
    if (!input.enabled) {
      return {
        serverInstanceId: server.instanceId,
        serverLabel: server.name,
        active: false,
        mode: 'inactive',
        resourceUris: [],
        detail: 'Event Inbox subscription stopped. Remote work may continue independently.',
      }
    }
    const connection = await this.connections.get(input.snapshot, server)
    const subscription = await connection.subscribeEvents({
      resourceUris: input.resourceUris,
      onEvent: (event) => this.addEvent(input.snapshot, server, event),
    })
    const state: McpEventSubscriptionState = {
      serverInstanceId: server.instanceId,
      serverLabel: server.name,
      active: true,
      mode: subscription.mode,
      resourceUris: subscription.resourceUris,
      detail:
        subscription.mode === 'modern-listen'
          ? 'Modern subscriptions/listen is active. Events stay in the inbox until selected.'
          : 'Legacy notifications and explicit resource subscriptions are active.',
    }
    this.eventSubscriptions.set(key, {
      sessionId: input.snapshot.sessionId,
      state,
      close: subscription.close,
    })
    return state
  }

  getEvents(sessionId?: string | null) {
    return sessionId ? (this.events.get(sessionId) ?? []) : [...this.events.values()].flat()
  }

  getEventSubscriptions(sessionId?: string | null) {
    const subscriptions = [...this.eventSubscriptions.values()]
    return sessionId
      ? subscriptions.flatMap((subscription) =>
          subscription.sessionId === sessionId ? [subscription.state] : [],
        )
      : subscriptions.map((subscription) => subscription.state)
  }

  async disposeSession(sessionId: string) {
    await this.connections.closeRuntimeNamespace(sessionId)
    for (const [handle, tool] of this.handles) {
      if (tool.runtimeNamespace === sessionId) this.handles.delete(handle)
    }
    this.notices.delete(sessionId)
    await this.remoteTasks.setDisabled({ sessionId, disabled: true })
  }

  async reconcileIdleConnections(isActive: (runtimeNamespace: string) => boolean) {
    const handleNamespaces = [...this.handles.values()].map((tool) => tool.runtimeNamespace)
    const idleNamespaces = await this.connections.closeIdle(isActive, [
      ...this.notices.keys(),
      ...handleNamespaces,
    ])
    for (const [handle, tool] of this.handles) {
      if (idleNamespaces.has(tool.runtimeNamespace)) this.handles.delete(handle)
    }
    for (const runtimeNamespace of idleNamespaces) this.notices.delete(runtimeNamespace)
  }

  async disposeAll() {
    await this.connections.closeAll()
    this.handles.clear()
    this.notices.clear()
    this.events.clear()
    await this.remoteTasks.setAllDisabled()
  }

  getConnectionStatuses() {
    return this.connections.getStatuses()
  }

  getNotices(sessionId?: string | null) {
    return sessionId ? (this.notices.get(sessionId) ?? []) : [...this.notices.values()].flat()
  }
}
