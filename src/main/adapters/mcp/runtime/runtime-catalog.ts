import { createHmac } from 'node:crypto'
import { MCP_CONFIG } from '@shared/constants/mcp'
import type { McpJsonValue, McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'
import { Clock, Effect, Ref } from 'effect'
import { resolveMcpRuntimeNamespace } from '../../../domain/mcp/runtime-namespace'
import {
  McpRequiredServerUnavailable,
  McpServerNotEnabled,
  McpStaleToolHandle,
  toMcpRuntimeError,
} from '../../../ports/mcp-errors'
import { createRemoteTaskRecords } from './remote-task-records'
import { addNotice } from './runtime-notices'
import type { CatalogTool, RuntimeStateContext } from './runtime-state-types'
import { mcpToolCatalogCacheKey } from './tool-catalog-cache'
import type { McpClientConnection, McpRuntimeTool } from './types'

const HANDLE_LENGTH = 24

export function makeHandle(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
  toolName: string,
) {
  const runtimeNamespace = resolveMcpRuntimeNamespace(snapshot)
  return `mcp_${createHmac('sha256', ctx.handleKey)
    .update(`${runtimeNamespace}\0${snapshot.revision}\0${server.instanceId}\0${toolName}`)
    .digest('base64url')
    .slice(0, HANDLE_LENGTH)}`
}

export function discardSupersededSessionConnections(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
) {
  return Effect.gen(function* () {
    const runtimeNamespace = resolveMcpRuntimeNamespace(snapshot)
    yield* ctx.connections.closeSuperseded(runtimeNamespace, snapshot.revision)
    yield* Ref.update(ctx.handles, (current) => {
      const next = new Map(current)
      for (const [handle, tool] of next) {
        if (
          tool.runtimeNamespace === runtimeNamespace &&
          tool.snapshotRevision !== snapshot.revision
        ) {
          next.delete(handle)
        }
      }
      return next
    })
    yield* Effect.promise(() =>
      ctx.remoteTasks.setDisabled({
        sessionId: snapshot.sessionId,
        enabledServers: snapshot.servers.map((server) => ({
          instanceId: server.instanceId,
          configHash: server.configHash,
        })),
        disabled: false,
      }),
    )
  })
}

export function getConnectionForServer(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  serverInstanceId: string,
) {
  return Effect.gen(function* () {
    const server = snapshot.servers.find((candidate) => candidate.instanceId === serverInstanceId)
    if (!server)
      return yield* Effect.fail(
        new McpServerNotEnabled({
          serverInstanceId,
          message: 'The requested MCP server is not enabled in this turn snapshot.',
        }),
      )
    const connection = yield* ctx.connections.get(snapshot, server)
    return { server, connection }
  })
}

/** Catalog entries for a server's tools, each addressable by its turn-scoped handle. */
export function toCatalogTools(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
  tools: readonly McpRuntimeTool[],
  source: CatalogTool['source'],
) {
  const runtimeNamespace = resolveMcpRuntimeNamespace(snapshot)
  return tools.map(
    (tool): CatalogTool => ({
      handle: makeHandle(ctx, snapshot, server, tool.name),
      server,
      tool,
      snapshotRevision: snapshot.revision,
      runtimeNamespace,
      source,
    }),
  )
}

/**
 * Lists a server's tools over an established connection and records them.
 *
 * The listing is recorded only while that connection is still the Session's current one: a
 * background listing can finish after the Session was disposed or reconnected, and its tools must
 * not come back as live handles. The tool list cache is updated either way, because the list
 * describes the configured server rather than this Session.
 */
export function listServerTools(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
  connection: McpClientConnection,
) {
  return Effect.gen(function* () {
    const key = ctx.connections.key(snapshot, server)
    const listedTools = yield* Effect.tryPromise({
      try: (signal) => connection.listTools(signal),
      catch: (error) => toMcpRuntimeError('listTools', error),
    })
    yield* Effect.promise(() =>
      ctx.toolCatalogCache
        .write(mcpToolCatalogCacheKey(snapshot, server), listedTools)
        .catch(() => undefined),
    )
    const tools = toCatalogTools(ctx, snapshot, server, listedTools, 'live')
    if (!(yield* ctx.connections.isCurrent(key, connection))) return tools
    const nowMs = yield* Clock.currentTimeMillis
    yield* Ref.update(ctx.handles, (current) => {
      const next = new Map(current)
      for (const tool of tools) next.set(tool.handle, tool)
      return next
    })
    yield* Ref.update(ctx.catalogs, (current) =>
      new Map(current).set(key, { expiresAt: nowMs + MCP_CONFIG.CATALOG_CACHE_TTL_MS, tools }),
    )
    return tools
  })
}

/** The server's live tools this turn has already listed, while that listing is fresh. */
export function freshServerCatalog(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
) {
  return Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis
    const cached = (yield* Ref.get(ctx.catalogs)).get(ctx.connections.key(snapshot, server))
    return cached && cached.expiresAt > nowMs ? cached.tools : undefined
  })
}

export function loadServerCatalog(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
) {
  return Effect.gen(function* () {
    const fresh = yield* freshServerCatalog(ctx, snapshot, server)
    if (fresh) return fresh
    const connection = yield* ctx.connections.get(snapshot, server)
    return yield* listServerTools(ctx, snapshot, server, connection)
  })
}

/** Records that a server could not connect, failing the turn when the server is required. */
export function reportServerUnavailable(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
  detail: string,
) {
  return Effect.gen(function* () {
    yield* addNotice(ctx, resolveMcpRuntimeNamespace(snapshot), {
      id: connectNoticeId(server),
      severity: server.definition.required ? 'error' : 'warning',
      title: `${server.name} MCP server could not connect`,
      detail,
      action: 'Run MCP doctor, review the server configuration, then retry the turn.',
      serverInstanceId: server.instanceId,
    })
    if (!server.definition.required) return
    return yield* Effect.fail(
      new McpRequiredServerUnavailable({
        serverInstanceId: server.instanceId,
        serverLabel: server.name,
        detail,
        message: `Required MCP server ${server.name} could not connect: ${detail}`,
      }),
    )
  })
}

/** The notice about a server's connection; a successful connect clears it. */
export function connectNoticeId(server: McpTurnSnapshotServer) {
  return `runtime:${server.instanceId}:connect`
}

export function loadCatalog(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  selectServer: (server: McpTurnSnapshotServer) => boolean = () => true,
) {
  return Effect.gen(function* () {
    yield* discardSupersededSessionConnections(ctx, snapshot)
    const selectedServers = snapshot.servers.filter(selectServer)
    const results = yield* Effect.forEach(
      selectedServers,
      (server) => Effect.either(loadServerCatalog(ctx, snapshot, server)),
      { concurrency: 'unbounded' },
    )
    const tools: CatalogTool[] = []
    for (const [index, result] of results.entries()) {
      const server = selectedServers[index]
      if (!server) continue
      if (result._tag === 'Right') tools.push(...result.right)
      else yield* reportServerUnavailable(ctx, snapshot, server, result.left.message)
    }
    return tools
  })
}

export function findHandle(ctx: RuntimeStateContext, snapshot: McpTurnSnapshot, handle: string) {
  return Ref.get(ctx.handles).pipe(
    Effect.flatMap((current) => {
      const tool = current.get(handle)
      if (
        !tool ||
        tool.runtimeNamespace !== resolveMcpRuntimeNamespace(snapshot) ||
        tool.snapshotRevision !== snapshot.revision
      ) {
        return Effect.fail(
          new McpStaleToolHandle({
            message: 'Unknown or stale MCP tool handle. Search or list tools again.',
          }),
        )
      }
      return Effect.succeed(tool)
    }),
  )
}

export function recordRemoteTasks(
  ctx: RuntimeStateContext,
  input: {
    readonly snapshot: McpTurnSnapshot
    readonly server: McpTurnSnapshotServer
    readonly connection: McpClientConnection
    readonly tasks: readonly McpJsonValue[]
  },
) {
  return Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) =>
      Effect.promise(() => ctx.remoteTasks.upsert(createRemoteTaskRecords({ ...input, now }))),
    ),
  )
}

export function listRemoteTasks(
  ctx: RuntimeStateContext,
  input?: Parameters<RuntimeStateContext['remoteTasks']['list']>[0],
) {
  return Effect.promise(() => ctx.remoteTasks.list(input))
}
