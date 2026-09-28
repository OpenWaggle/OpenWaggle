import { createHmac } from 'node:crypto'
import { canonicalJson } from '@shared/canonical-json'
import { MCP_CONFIG } from '@shared/constants/mcp'
import type { McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'
import { Clock, Deferred, Effect, Ref, SynchronizedRef } from 'effect'
import {
  serverOffersToolDirectly,
  serverRequestsDirectTools,
} from '../../../domain/mcp/direct-tool-servers'
import { resolveMcpRuntimeNamespace } from '../../../domain/mcp/runtime-namespace'
import { type McpRuntimeFailure, toMcpRuntimeError } from '../../../ports/mcp-errors'
import type { CatalogTool, RuntimeStateContext, ServerListing } from './runtime-state-types'
import { mcpToolCatalogIdentity } from './tool-catalog-cache'
import type { McpClientConnection, McpRuntimeTool } from './types'

const HANDLE_LENGTH = 24

/** The input schema a tool's arguments are built from, in a form two listings can compare. */
export function inputSchemaFingerprint(tool: McpRuntimeTool) {
  return canonicalJson(tool.inputSchema ?? null)
}

/**
 * A tool's opaque handle: bound to the Session namespace, snapshot revision, server, tool name
 * and input schema (ADR 0013). A changed schema is a different handle, so arguments the model
 * built from an older schema can never reach the tool that replaced it.
 */
export function makeHandle(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
  tool: McpRuntimeTool,
) {
  const runtimeNamespace = resolveMcpRuntimeNamespace(snapshot)
  const identity = [
    runtimeNamespace,
    snapshot.revision,
    server.instanceId,
    tool.name,
    inputSchemaFingerprint(tool),
  ].join('\0')
  return `mcp_${createHmac('sha256', ctx.handleKey)
    .update(identity)
    .digest('base64url')
    .slice(0, HANDLE_LENGTH)}`
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
      handle: makeHandle(ctx, snapshot, server, tool),
      server,
      tool,
      snapshotRevision: snapshot.revision,
      runtimeNamespace,
      source,
    }),
  )
}

/** The part of a tool the cache stands in with: what a direct-tool descriptor is built from. */
function cachedToolDefinition(tool: McpRuntimeTool): McpRuntimeTool {
  return {
    name: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    ...(tool.description === undefined ? {} : { description: tool.description }),
    ...(tool.inputSchema === undefined ? {} : { inputSchema: tool.inputSchema }),
  }
}

/**
 * Remembers a server's direct tools for later Sessions, off the listing's critical path.
 *
 * Only what a later turn can stand in with is kept: the selected direct tools of an optional
 * server. A required server is always waited for, and other tools never become descriptors. A
 * listing over a connection opened before its server's lists were forgotten (a sign-out, a new
 * sign-in, a changed secret) still speaks for the old credentials and is not remembered.
 */
function rememberToolList(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
  tools: readonly McpRuntimeTool[],
) {
  return Effect.gen(function* () {
    if (!serverRequestsDirectTools(server) || server.definition.required) return
    const key = ctx.connections.key(snapshot, server)
    if ((yield* Ref.get(ctx.forgottenConnections)).has(key)) return
    const identity = mcpToolCatalogIdentity(snapshot, server)
    const definitions = tools
      .filter((tool) => serverOffersToolDirectly(server, tool.name))
      .map(cachedToolDefinition)
    yield* Effect.forkDaemon(
      Effect.promise(() =>
        ctx.toolCatalogCache.write(identity, definitions).catch(() => undefined),
      ),
    )
  })
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
    yield* rememberToolList(ctx, snapshot, server, listedTools)
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

/** The server's live tools this Session has already listed, while that listing is fresh. */
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

function forgetListing(ctx: RuntimeStateContext, key: string, listing: ServerListing) {
  return SynchronizedRef.update(ctx.listings, (current) => {
    if (current.get(key) !== listing) return current
    const next = new Map(current)
    next.delete(key)
    return next
  })
}

function joinableListing(ctx: RuntimeStateContext, key: string) {
  return SynchronizedRef.get(ctx.listings).pipe(
    Effect.map((current) => {
      const existing = current.get(key)
      return existing && !existing.retired.aborted ? existing : undefined
    }),
  )
}

/**
 * Starts, or joins, the listing of a server's tools for this Session.
 *
 * One listing runs per connection at a time, so a turn's background listing and the calls that
 * need the same list share it instead of each listing the server again. The connection is
 * started before this returns, under the caller's lifecycle lock, and outside the Host-wide
 * listing table: starting can wait for a closing slot of the same key, which must not hold up
 * other Sessions' listings. The listing runs on a daemon so a caller that stops waiting never
 * strands the others. A listing whose connection was retired is not joined.
 */
export function startServerListing(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
): Effect.Effect<ServerListing> {
  const key = ctx.connections.key(snapshot, server)
  return Effect.gen(function* () {
    const joined = yield* joinableListing(ctx, key)
    if (joined) return joined
    const attempt = yield* ctx.connections.start(snapshot, server)
    return yield* SynchronizedRef.modifyEffect(ctx.listings, (current) => {
      const existing = current.get(key)
      if (existing && !existing.retired.aborted) return Effect.succeed([existing, current] as const)
      return Effect.gen(function* () {
        const result = yield* Deferred.make<readonly CatalogTool[], McpRuntimeFailure>()
        const listing: ServerListing = { result, retired: attempt.retired }
        yield* Effect.forkDaemon(
          attempt.connection.pipe(
            Effect.flatMap((connection) => listServerTools(ctx, snapshot, server, connection)),
            Effect.exit,
            Effect.flatMap((exit) => Deferred.done(result, exit)),
            Effect.ensuring(forgetListing(ctx, key, listing)),
          ),
        )
        return [listing, new Map(current).set(key, listing)] as const
      })
    })
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
    const listing = yield* startServerListing(ctx, snapshot, server)
    return yield* Deferred.await(listing.result)
  })
}
