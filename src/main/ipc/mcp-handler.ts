import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { McpServerId } from '@shared/types/brand'
import type { McpServerConfig } from '@shared/types/mcp'
import { mcpServerConfigSchema } from '@shared/types/mcp'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { mcpManager } from '../mcp'
import { getSettings, updateSettings } from '../store/settings'
import { typedHandle } from './typed-ipc'

const logger = createLogger('mcp-handler')
const mcpServerConfigDraftSchema = mcpServerConfigSchema.omit('id')
const mcpServerConfigUpdatesSchema = Schema.partial(mcpServerConfigDraftSchema)
const nonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))

function catchMcpError<A>(
  operation: string,
  effect: Effect.Effect<A, unknown>,
): Effect.Effect<A | { readonly ok: false; readonly error: string }, never> {
  const errorHandler = (err: unknown) =>
    Effect.sync((): { readonly ok: false; readonly error: string } => {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`${operation} failed`, { error: message })
      return { ok: false, error: message }
    })

  return Effect.catchAllDefect(Effect.catchAll(effect, errorHandler), errorHandler)
}

export function registerMcpHandlers(): void {
  typedHandle('mcp:list-servers', () =>
    Effect.sync(() => {
      const settings = getSettings()
      const liveStatuses = mcpManager.getServerStatuses()
      const liveIds = new Set(liveStatuses.map((s) => s.id))

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
    }),
  )

  typedHandle('mcp:add-server', (_event, rawConfig) =>
    catchMcpError(
      'add server',
      Effect.gen(function* () {
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

        const id = yield* Effect.promise(() => mcpManager.addServer(config))
        const fullConfig: McpServerConfig = { ...config, id }

        const settings = getSettings()
        updateSettings({
          mcpServers: [...settings.mcpServers, fullConfig],
        })

        logger.info('server added', { id, name: config.name })
        return { ok: true as const, id }
      }),
    ),
  )

  typedHandle('mcp:remove-server', (_event, rawId) =>
    catchMcpError(
      'remove server',
      Effect.gen(function* () {
        const id = decodeUnknownOrThrow(nonEmptyStringSchema, rawId)
        const mcpId = McpServerId(id)

        yield* Effect.promise(() => mcpManager.removeServer(mcpId))

        const settings = getSettings()
        updateSettings({
          mcpServers: settings.mcpServers.filter((s) => s.id !== mcpId),
        })

        logger.info('server removed', { id })
        return { ok: true as const }
      }),
    ),
  )

  typedHandle('mcp:toggle-server', (_event, rawId, enabled) =>
    catchMcpError(
      'toggle server',
      Effect.gen(function* () {
        const id = decodeUnknownOrThrow(nonEmptyStringSchema, rawId)
        const mcpId = McpServerId(id)
        const parsedEnabled = decodeUnknownOrThrow(Schema.Boolean, enabled)

        const settings = getSettings()
        const config = settings.mcpServers.find((s) => s.id === mcpId)
        if (!config) {
          return { ok: false as const, error: `Server ${id} not found in configuration` }
        }

        const updatedConfig: McpServerConfig = { ...config, enabled: parsedEnabled }
        yield* Effect.promise(() => mcpManager.toggleServer(mcpId, parsedEnabled, updatedConfig))

        updateSettings({
          mcpServers: settings.mcpServers.map((s) => (s.id === mcpId ? updatedConfig : s)),
        })

        logger.info('server toggled', { id, enabled: parsedEnabled })
        return { ok: true as const }
      }),
    ),
  )

  typedHandle('mcp:update-server', (_event, rawId, rawUpdates) =>
    catchMcpError(
      'update server',
      Effect.gen(function* () {
        const id = decodeUnknownOrThrow(nonEmptyStringSchema, rawId)
        const mcpId = McpServerId(id)
        const updates = decodeUnknownOrThrow(mcpServerConfigUpdatesSchema, rawUpdates)

        const settings = getSettings()
        const existing = settings.mcpServers.find((s) => s.id === mcpId)
        if (!existing) {
          return { ok: false as const, error: `Server ${id} not found in configuration` }
        }

        const updatedConfig: McpServerConfig = { ...existing, ...updates }

        if (updatedConfig.enabled) {
          yield* Effect.promise(() => mcpManager.toggleServer(mcpId, false, existing))
          yield* Effect.promise(() => mcpManager.toggleServer(mcpId, true, updatedConfig))
        }

        updateSettings({
          mcpServers: settings.mcpServers.map((s) => (s.id === mcpId ? updatedConfig : s)),
        })

        logger.info('server updated', { id, updates: Object.keys(updates) })
        return { ok: true as const }
      }),
    ),
  )
}
