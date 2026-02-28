import { randomUUID } from 'node:crypto'
import { McpServerId } from '@shared/types/brand'
import type { McpServerConfig, McpServerStatus } from '@shared/types/mcp'
import type { ServerTool } from '@tanstack/ai'
import { BrowserWindow } from 'electron'
import { createLogger } from '../logger'
import { McpClient } from './mcp-client'
import { bridgeMcpTool } from './mcp-tool-bridge'

const logger = createLogger('mcp-manager')

class McpManager {
  private clients = new Map<string, McpClient>()
  /** Guards against duplicate concurrent add/remove operations for the same server ID */
  private pendingOps = new Set<string>()

  async initialize(configs: readonly McpServerConfig[]): Promise<void> {
    logger.info('initializing', { serverCount: configs.length })
    const enabledConfigs = configs.filter((c) => c.enabled)

    await Promise.allSettled(enabledConfigs.map((config) => this.connectServer(config)))

    logger.info('initialization complete', {
      connected: this.getConnectedCount(),
      total: enabledConfigs.length,
    })
  }

  async addServer(configWithoutId: Omit<McpServerConfig, 'id'>): Promise<McpServerId> {
    const id = McpServerId(randomUUID())
    const config: McpServerConfig = { ...configWithoutId, id }

    if (this.pendingOps.has(id)) {
      throw new Error(`Operation already in progress for server ${id}`)
    }

    this.pendingOps.add(id)
    try {
      if (config.enabled) {
        await this.connectServer(config)
      }
      return id
    } finally {
      this.pendingOps.delete(id)
    }
  }

  async removeServer(id: McpServerId): Promise<void> {
    if (this.pendingOps.has(id)) {
      throw new Error(`Operation already in progress for server ${id}`)
    }

    this.pendingOps.add(id)
    try {
      const client = this.clients.get(id)
      if (client) {
        await client.disconnect()
        this.clients.delete(id)
      }
    } finally {
      this.pendingOps.delete(id)
    }
  }

  async toggleServer(id: McpServerId, enabled: boolean, config: McpServerConfig): Promise<void> {
    if (this.pendingOps.has(id)) {
      throw new Error(`Operation already in progress for server ${id}`)
    }

    this.pendingOps.add(id)
    try {
      const existing = this.clients.get(id)

      if (enabled) {
        if (existing && existing.status === 'connected') return
        // Disconnect old client if exists, reconnect fresh
        if (existing) {
          await existing.disconnect()
          this.clients.delete(id)
        }
        await this.connectServer(config)
      } else {
        if (existing) {
          await existing.disconnect()
          this.clients.delete(id)
        }
      }
    } finally {
      this.pendingOps.delete(id)
    }
  }

  getServerTools(): ServerTool[] {
    const tools: ServerTool[] = []

    for (const client of this.clients.values()) {
      if (client.status !== 'connected') continue
      for (const tool of client.toolList) {
        tools.push(bridgeMcpTool(tool, client))
      }
    }

    return tools
  }

  getServerStatuses(): McpServerStatus[] {
    const statuses: McpServerStatus[] = []
    for (const client of this.clients.values()) {
      statuses.push(buildStatusFromClient(client))
    }
    return statuses
  }

  getStatusForServer(id: McpServerId): McpServerStatus | undefined {
    const client = this.clients.get(id)
    if (!client) return undefined
    return buildStatusFromClient(client)
  }

  hasConnectedServers(): boolean {
    for (const client of this.clients.values()) {
      if (client.status === 'connected') return true
    }
    return false
  }

  async disconnectAll(): Promise<void> {
    logger.info('disconnecting all servers', { count: this.clients.size })
    await Promise.allSettled(Array.from(this.clients.values()).map((client) => client.disconnect()))
    this.clients.clear()
  }

  private async connectServer(config: McpServerConfig): Promise<void> {
    const client = new McpClient(config, {
      onStatusChange: () => {
        this.broadcastStatus(buildStatusFromClient(client))
      },
      onToolsChanged: () => {
        this.broadcastStatus(buildStatusFromClient(client))
      },
    })

    this.clients.set(config.id, client)
    await client.connect()
  }

  private broadcastStatus(status: McpServerStatus): void {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('mcp:status-changed', status)
    }
  }

  private getConnectedCount(): number {
    let count = 0
    for (const client of this.clients.values()) {
      if (client.status === 'connected') count++
    }
    return count
  }
}

function buildStatusFromClient(client: McpClient): McpServerStatus {
  return {
    id: client.config.id,
    name: client.config.name,
    status: client.status,
    error: client.error,
    toolCount: client.toolList.length,
    tools: client.toolList,
  }
}

export const mcpManager = new McpManager()
