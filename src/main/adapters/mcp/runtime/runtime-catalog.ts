import type { McpJsonValue, McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'
import { Clock, Effect, Ref } from 'effect'
import { resolveMcpRuntimeNamespace } from '../../../domain/mcp/runtime-namespace'
import { McpServerNotEnabled, McpStaleToolHandle } from '../../../ports/mcp-errors'
import { createRemoteTaskRecords } from './remote-task-records'
import { reportServerUnavailable } from './runtime-notices'
import { loadServerCatalog } from './runtime-server-listing'
import type { CatalogTool, RuntimeStateContext } from './runtime-state-types'
import type { McpClientConnection } from './types'

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
