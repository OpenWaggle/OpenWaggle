import type { McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'
import { Effect, Option } from 'effect'
import { serverRequestsDirectTools } from '../../../domain/mcp/direct-tool-servers'
import { type McpRuntimeFailure, McpStaleToolHandle } from '../../../ports/mcp-errors'
import { findHandle, loadCatalog } from './runtime-catalog'
import { reportServerUnavailable } from './runtime-notices'
import { freshServerCatalog, loadServerCatalog } from './runtime-server-listing'
import type { CatalogTool, RuntimeStateContext } from './runtime-state-types'

/**
 * The live tool behind a handle.
 *
 * A handle is used as it is while this Session's fresh listing of its server still has it. Any
 * other handle (one from the tool list cache, or from a listing that has since aged out) waits
 * for the server's live listing first. Handles include the input schema, so a tool whose schema
 * changed since the model saw it is no longer in that listing and is refused before dispatch.
 */
export function resolveToolHandle(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  handle: string,
): Effect.Effect<CatalogTool, McpRuntimeFailure> {
  return Effect.gen(function* () {
    const known = yield* findHandle(ctx, snapshot, handle).pipe(Effect.option)
    if (Option.isNone(known)) {
      yield* loadCatalog(ctx, snapshot)
      return yield* findHandle(ctx, snapshot, handle)
    }
    const tool = known.value
    const server =
      snapshot.servers.find((candidate) => candidate.instanceId === tool.server.instanceId) ??
      tool.server
    const fresh = yield* freshServerCatalog(ctx, snapshot, server)
    const freshTool = fresh?.find((candidate) => candidate.handle === handle)
    if (freshTool) return freshTool
    // Reported like any listing of the server, so a required server still fails as required.
    const liveTools = yield* loadServerCatalog(ctx, snapshot, server).pipe(
      Effect.tapError((error) => reportServerUnavailable(ctx, snapshot, server, error.message)),
    )
    const live = liveTools.find((candidate) => candidate.handle === handle)
    if (live) return live
    const stillOffered = liveTools.some((candidate) => candidate.tool.name === tool.tool.name)
    return yield* Effect.fail(
      new McpStaleToolHandle({ message: staleToolMessage(tool, server, stillOffered) }),
    )
  })
}

/** What the model is told when a tool it saw is gone or changed: how to get the current one. */
function staleToolMessage(tool: CatalogTool, server: McpTurnSnapshotServer, stillOffered: boolean) {
  const lookUp = 'Search or list tools with the mcp tool to get its current handle and schema.'
  if (!stillOffered)
    return `${server.name} no longer offers the MCP tool ${tool.tool.name}. ${lookUp}`
  const nextTurn = serverRequestsDirectTools(server) ? ' The next turn offers it directly.' : ''
  return `The MCP tool ${tool.tool.name} on ${server.name} changed its input schema since this turn saw it. ${lookUp}${nextTurn}`
}
