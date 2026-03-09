import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { McpServerId } from '@shared/types/brand'
import type { McpServerConfig } from '@shared/types/mcp'
import { mcpServerConfigSchema } from '@shared/types/mcp'
import { createLogger } from '../logger'
import { mcpManager } from '../mcp'
import { getSettings, updateSettings } from '../store/settings'
import { safeHandle } from './typed-ipc'

const logger = createLogger('mcp-handler')
const mcpServerConfigDraftSchema = mcpServerConfigSchema.omit('id')
const mcpServerConfigUpdatesSchema = Schema.partial(mcpServerConfigDraftSchema)
const nonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))

export function registerMcpHandlers(): void {
  safeHandle('mcp:list-servers', () => {
    const settings = getSettings()
    const liveStatuses = mcpManager.getServerStatuses()
    const liveIds = new Set(liveStatuses.map((s) => s.id))

    // Include servers from config that aren't yet connected
    const configOnlyStatuses = settings.mcpServers
      .filter((c) => !liveIds.has(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        status: 'disconnected' as const,
        toolCount: 0,
        tools: [],
      }))

    return [...liveStatuses, ...configOnlyStatuses]
  })

  safeHandle('mcp:add-server', async (_event, rawConfig) => {
    try {
      const parsed = decodeUnknownOrThrow(mcpServerConfigDraftSchema, rawConfig)
      const config: Omit<McpServerConfig, 'id'> = {
        name: parsed.name,
        transport: parsed.transport,
        enabled: parsed.enabled,
        command: parsed.command,
        args: parsed.args,
        env: parsed.env,
        url: parsed.url,
      }

      const id = await mcpManager.addServer(config)
      const fullConfig: McpServerConfig = { ...config, id }

      // Persist to settings
      const settings = getSettings()
      updateSettings({
        mcpServers: [...settings.mcpServers, fullConfig],
      })

      logger.info('server added', { id, name: config.name })
      return { ok: true, id }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('add server failed', { error: message })
      return { ok: false, error: message }
    }
  })

  safeHandle('mcp:remove-server', async (_event, rawId) => {
    try {
      const id = decodeUnknownOrThrow(nonEmptyStringSchema, rawId)
      const mcpId = McpServerId(id)

      await mcpManager.removeServer(mcpId)

      // Remove from settings
      const settings = getSettings()
      updateSettings({
        mcpServers: settings.mcpServers.filter((s) => s.id !== mcpId),
      })

      logger.info('server removed', { id })
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('remove server failed', { error: message })
      return { ok: false, error: message }
    }
  })

  safeHandle('mcp:toggle-server', async (_event, rawId, enabled) => {
    try {
      const id = decodeUnknownOrThrow(nonEmptyStringSchema, rawId)
      const mcpId = McpServerId(id)
      const parsedEnabled = decodeUnknownOrThrow(Schema.Boolean, enabled)

      const settings = getSettings()
      const config = settings.mcpServers.find((s) => s.id === mcpId)
      if (!config) {
        return { ok: false, error: `Server ${id} not found in configuration` }
      }

      const updatedConfig: McpServerConfig = { ...config, enabled: parsedEnabled }
      await mcpManager.toggleServer(mcpId, parsedEnabled, updatedConfig)

      // Persist toggle state
      updateSettings({
        mcpServers: settings.mcpServers.map((s) => (s.id === mcpId ? updatedConfig : s)),
      })

      logger.info('server toggled', { id, enabled: parsedEnabled })
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('toggle server failed', { error: message })
      return { ok: false, error: message }
    }
  })

  safeHandle('mcp:update-server', async (_event, rawId, rawUpdates) => {
    try {
      const id = decodeUnknownOrThrow(nonEmptyStringSchema, rawId)
      const mcpId = McpServerId(id)
      const updates = decodeUnknownOrThrow(mcpServerConfigUpdatesSchema, rawUpdates)

      const settings = getSettings()
      const existing = settings.mcpServers.find((s) => s.id === mcpId)
      if (!existing) {
        return { ok: false, error: `Server ${id} not found in configuration` }
      }

      const updatedConfig: McpServerConfig = { ...existing, ...updates }

      // If server is enabled, reconnect with new config
      if (updatedConfig.enabled) {
        await mcpManager.toggleServer(mcpId, false, existing)
        await mcpManager.toggleServer(mcpId, true, updatedConfig)
      }

      updateSettings({
        mcpServers: settings.mcpServers.map((s) => (s.id === mcpId ? updatedConfig : s)),
      })

      logger.info('server updated', { id, updates: Object.keys(updates) })
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('update server failed', { error: message })
      return { ok: false, error: message }
    }
  })
}
