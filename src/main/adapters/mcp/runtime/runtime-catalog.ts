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
import type { McpClientConnection } from './types'

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

function loadServerCatalog(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
) {
  return Effect.gen(function* () {
    const key = ctx.connections.key(snapshot, server)
    const nowMs = yield* Clock.currentTimeMillis
    const cached = (yield* Ref.get(ctx.catalogs)).get(key)
    if (cached && cached.expiresAt > nowMs) return cached.tools
    const connection = yield* ctx.connections.get(snapshot, server)
    const listedTools = yield* Effect.tryPromise({
      try: (signal) => connection.listTools(signal),
      catch: (error) => toMcpRuntimeError('listTools', error),
    })
    const runtimeNamespace = resolveMcpRuntimeNamespace(snapshot)
    const tools = listedTools.map(
      (tool): CatalogTool => ({
        handle: makeHandle(ctx, snapshot, server, tool.name),
        server,
        connection,
        tool,
        snapshotRevision: snapshot.revision,
        runtimeNamespace,
      }),
    )
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
    const namespace = resolveMcpRuntimeNamespace(snapshot)
    const tools: CatalogTool[] = []
    for (const [index, result] of results.entries()) {
      const server = selectedServers[index]
      if (!server) continue
      if (result._tag === 'Right') {
        tools.push(...result.right)
        continue
      }
      const detail = result.left.message
      yield* addNotice(ctx, namespace, {
        id: `runtime:${server.instanceId}:connect`,
        severity: server.definition.required ? 'error' : 'warning',
        title: `${server.name} MCP server could not connect`,
        detail,
        action: 'Run MCP doctor, review the server configuration, then retry the turn.',
        serverInstanceId: server.instanceId,
      })
      if (server.definition.required) {
        return yield* Effect.fail(
          new McpRequiredServerUnavailable({
            serverInstanceId: server.instanceId,
            serverLabel: server.name,
            detail,
            message: `Required MCP server ${server.name} could not connect: ${detail}`,
          }),
        )
      }
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
