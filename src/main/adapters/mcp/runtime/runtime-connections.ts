import type { McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'
import { resolveMcpRuntimeNamespace } from '../../../domain/mcp/runtime-namespace'
import type { McpRuntimeConnectionStatus } from '../../../ports/mcp-runtime-service'
import type { McpClientConnection, McpConnectionFactory } from './types'

function connectionKey(snapshot: McpTurnSnapshot, server: McpTurnSnapshotServer) {
  return `${resolveMcpRuntimeNamespace(snapshot)}:${snapshot.revision}:${server.instanceId}`
}

export class McpRuntimeConnections {
  private readonly connections = new Map<string, Promise<McpClientConnection>>()
  private readonly statuses = new Map<string, McpRuntimeConnectionStatus>()

  constructor(
    private readonly connect: McpConnectionFactory,
    private readonly onClose: (key: string) => Promise<void>,
    private readonly onConnected: (runtimeNamespace: string, serverInstanceId: string) => void,
  ) {}

  key(snapshot: McpTurnSnapshot, server: McpTurnSnapshotServer) {
    return connectionKey(snapshot, server)
  }

  private matchingKeys(predicate: (status: McpRuntimeConnectionStatus, key: string) => boolean) {
    const keys: string[] = []
    for (const [key, status] of this.statuses) {
      if (predicate(status, key)) keys.push(key)
    }
    return keys
  }

  private async close(key: string) {
    const pending = this.connections.get(key)
    this.connections.delete(key)
    this.statuses.delete(key)
    await this.onClose(key)
    if (!pending) return
    const connection = await pending.catch(() => null)
    await connection?.close().catch(() => undefined)
  }

  async get(snapshot: McpTurnSnapshot, server: McpTurnSnapshotServer) {
    const key = connectionKey(snapshot, server)
    const existing = this.connections.get(key)
    if (existing) return existing
    const runtimeNamespace = resolveMcpRuntimeNamespace(snapshot)
    this.statuses.set(key, {
      runtimeNamespace,
      sessionId: snapshot.sessionId,
      projectPath: snapshot.projectPath,
      snapshotRevision: snapshot.revision,
      serverInstanceId: server.instanceId,
      connectionState: 'connecting',
      capabilities: [],
    })
    try {
      const pending = this.connect({ snapshot, server })
      this.connections.set(key, pending)
      const connection = await pending
      if (this.connections.get(key) === pending) {
        this.statuses.set(key, {
          runtimeNamespace,
          sessionId: snapshot.sessionId,
          projectPath: snapshot.projectPath,
          snapshotRevision: snapshot.revision,
          serverInstanceId: server.instanceId,
          connectionState: 'connected',
          negotiatedProtocolVersion: connection.negotiatedProtocolVersion,
          capabilities: connection.capabilities,
        })
        this.onConnected(runtimeNamespace, server.instanceId)
      }
      return connection
    } catch (error) {
      this.connections.delete(key)
      this.statuses.delete(key)
      throw error
    }
  }

  async closeSuperseded(runtimeNamespace: string, snapshotRevision: string) {
    await Promise.all(
      this.matchingKeys(
        (status) =>
          status.runtimeNamespace === runtimeNamespace &&
          status.snapshotRevision !== snapshotRevision,
      ).map((key) => this.close(key)),
    )
  }

  async closeRuntimeNamespace(runtimeNamespace: string) {
    await Promise.all(
      this.matchingKeys((status) => status.runtimeNamespace === runtimeNamespace).map((key) =>
        this.close(key),
      ),
    )
  }

  async closeIdle(
    isActive: (runtimeNamespace: string) => boolean,
    additionalNamespaces: Iterable<string>,
  ) {
    const idleNamespaces = new Set<string>()
    for (const status of this.statuses.values()) {
      if (!isActive(status.runtimeNamespace)) idleNamespaces.add(status.runtimeNamespace)
    }
    for (const runtimeNamespace of additionalNamespaces) {
      if (!isActive(runtimeNamespace)) idleNamespaces.add(runtimeNamespace)
    }
    await Promise.all(
      this.matchingKeys((status) => idleNamespaces.has(status.runtimeNamespace)).map((key) =>
        this.close(key),
      ),
    )
    return idleNamespaces
  }

  async closeAll() {
    await Promise.all([...this.connections.keys()].map((key) => this.close(key)))
  }

  getStatuses() {
    return [...this.statuses.values()]
  }
}
