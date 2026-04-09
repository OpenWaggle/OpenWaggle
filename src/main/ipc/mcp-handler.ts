import { randomUUID } from 'node:crypto'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { McpServerId } from '@shared/types/brand'
import type { McpServerConfig } from '@shared/types/mcp'
import { mcpServerConfigSchema } from '@shared/types/mcp'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { mcpManager } from '../mcp'
import { SettingsService } from '../services/settings-service'
import { typedHandle } from './typed-ipc'

const logger = createLogger('mcp-handler')
const mcpServerConfigDraftSchema = mcpServerConfigSchema.omit('id')
const mcpServerConfigUpdatesSchema = Schema.partial(mcpServerConfigDraftSchema)
const nonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))

function catchMcpError<A, R>(
  operation: string,
  effect: Effect.Effect<A, unknown, R>,
): Effect.Effect<A | { readonly ok: false; readonly error: string }, never, R> {
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
    Effect.gen(function* () {
      const settingsService = yield* SettingsService
      const settings = yield* settingsService.get()
      const liveStatuses = mcpManager.getServerStatuses()
      const liveStatusById = new Map(liveStatuses.map((s) => [s.id, s]))

      // Build status list in settings order — preserves stable insertion order
      // so servers don't jump between groups on connect/disconnect
      return settings.mcpServers.map((config) => {
        const live = liveStatusById.get(config.id)
        if (live) return live
        return {
          id: config.id,
          name: config.name,
          status: 'disconnected' as const,
          toolCount: 0,
          tools: [],
        }
      })
    }),
  )

  typedHandle('mcp:add-server', (_event, rawConfig) =>
    catchMcpError(
      'add server',
      Effect.gen(function* () {
        const parsed = decodeUnknownOrThrow(mcpServerConfigDraftSchema, rawConfig)
        const id = McpServerId(randomUUID())
        const fullConfig: McpServerConfig = {
          id,
          name: parsed.name,
          transport: parsed.transport,
          enabled: parsed.enabled,
          createdAt: Date.now(),
          command: parsed.command,
          args: parsed.args,
          env: parsed.env,
          url: parsed.url,
        }

        // Persist to settings BEFORE connecting — eliminates ghost servers
        // where status broadcasts make the server visible in UI before settings exist
        const settingsService = yield* SettingsService
        yield* settingsService.transformMcpServers((servers) => [...servers, fullConfig])

        // Connect asynchronously — failures are non-fatal (server stays in settings,
        // user can retry via toggle)
        yield* Effect.promise(() => mcpManager.addServer(fullConfig))

        logger.info('server added', { id, name: fullConfig.name })
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

        const settingsService = yield* SettingsService
        yield* settingsService.transformMcpServers((servers) =>
          servers.filter((s) => s.id !== mcpId),
        )

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

        const settingsService = yield* SettingsService
        const settings = yield* settingsService.get()
        const config = settings.mcpServers.find((s) => s.id === mcpId)
        if (!config) {
          return { ok: false as const, error: `Server ${id} not found in configuration` }
        }

        const updatedConfig: McpServerConfig = { ...config, enabled: parsedEnabled }

        // Update settings atomically, then connect/disconnect
        yield* settingsService.transformMcpServers((servers) =>
          servers.map((s) => (s.id === mcpId ? updatedConfig : s)),
        )
        yield* Effect.promise(() => mcpManager.toggleServer(mcpId, parsedEnabled, updatedConfig))

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

        const settingsService = yield* SettingsService
        const settings = yield* settingsService.get()
        const existing = settings.mcpServers.find((s) => s.id === mcpId)
        if (!existing) {
          return { ok: false as const, error: `Server ${id} not found in configuration` }
        }

        const updatedConfig: McpServerConfig = { ...existing, ...updates }

        // Update settings atomically first
        yield* settingsService.transformMcpServers((servers) =>
          servers.map((s) => (s.id === mcpId ? updatedConfig : s)),
        )

        if (updatedConfig.enabled) {
          yield* Effect.promise(() => mcpManager.toggleServer(mcpId, false, existing))
          yield* Effect.promise(() => mcpManager.toggleServer(mcpId, true, updatedConfig))
        }

        logger.info('server updated', { id, updates: Object.keys(updates) })
        return { ok: true as const }
      }),
    ),
  )
}
