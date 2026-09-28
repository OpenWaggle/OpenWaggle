import { canonicalJson } from '@shared/canonical-json'
import type { McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'
import { Duration, Effect, Either, Exit, Fiber, Option, Ref } from 'effect'
import { serverRequestsDirectTools } from '../../../domain/mcp/direct-tool-servers'
import { resolveMcpRuntimeNamespace } from '../../../domain/mcp/runtime-namespace'
import { type McpRuntimeFailure, McpStaleToolHandle } from '../../../ports/mcp-errors'
import type { McpDirectToolListOptions } from '../../../ports/mcp-runtime-service'
import {
  connectNoticeId,
  discardSupersededSessionConnections,
  findHandle,
  freshServerCatalog,
  listServerTools,
  loadCatalog,
  loadServerCatalog,
  reportServerUnavailable,
  toCatalogTools,
} from './runtime-catalog'
import { addNotice, removeNotice } from './runtime-notices'
import type { CatalogTool, RuntimeStateContext } from './runtime-state-types'
import { mcpToolCatalogCacheKey } from './tool-catalog-cache'

type BackgroundListing = Fiber.RuntimeFiber<
  Either.Either<readonly CatalogTool[], McpRuntimeFailure>
>

/** How a turn gets one server's direct tools. */
type ServerPlan =
  | { readonly type: 'ready'; readonly tools: readonly CatalogTool[] }
  | { readonly type: 'required'; readonly server: McpTurnSnapshotServer }
  | {
      readonly type: 'grace'
      readonly server: McpTurnSnapshotServer
      readonly listing: BackgroundListing
    }

function namespaceIsLive(ctx: RuntimeStateContext, runtimeNamespace: string) {
  return Ref.get(ctx.eventSubscriptionLifecycle).pipe(
    Effect.map((lifecycle) => {
      const entry = lifecycle.namespaces.get(runtimeNamespace)
      return entry ? entry.active : lifecycle.acceptUnknownNamespaces
    }),
  )
}

/**
 * Lists a server's tools on a background fiber that outlives the turn's wait for it.
 *
 * The connection is started before the fiber is forked, while the caller still holds the runtime
 * lifecycle lock, so a dispose that follows finds and retires it. A failure is reported as a
 * notice unless the Session is gone by then.
 */
function listInBackground(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
) {
  return Effect.gen(function* () {
    const awaitConnection = yield* ctx.connections.start(snapshot, server)
    const runtimeNamespace = resolveMcpRuntimeNamespace(snapshot)
    const listing = awaitConnection.pipe(
      Effect.flatMap((connection) => listServerTools(ctx, snapshot, server, connection)),
      Effect.tap(() => removeNotice(ctx, runtimeNamespace, connectNoticeId(server))),
      Effect.tapError((error) =>
        namespaceIsLive(ctx, runtimeNamespace).pipe(
          Effect.flatMap((live) =>
            live
              ? reportServerUnavailable(ctx, snapshot, server, error.message).pipe(
                  Effect.catchAll(() => Effect.void),
                )
              : Effect.void,
          ),
        ),
      ),
      Effect.either,
    )
    return yield* Effect.forkDaemon(listing)
  })
}

/** Registers cached tools as handles, never displacing a tool the live listing already recorded. */
function registerCachedTools(ctx: RuntimeStateContext, tools: readonly CatalogTool[]) {
  return Ref.update(ctx.handles, (current) => {
    const next = new Map(current)
    for (const tool of tools) {
      if (next.get(tool.handle)?.source !== 'live') next.set(tool.handle, tool)
    }
    return next
  })
}

function planServer(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
) {
  return Effect.gen(function* () {
    const fresh = yield* freshServerCatalog(ctx, snapshot, server)
    if (fresh) return { type: 'ready', tools: fresh } satisfies ServerPlan
    // A required server gates the turn (ADR 0013), so it is never stood in for by the cache.
    if (server.definition.required) return { type: 'required', server } satisfies ServerPlan
    const listing = yield* listInBackground(ctx, snapshot, server)
    const cachedTools = yield* Effect.promise(() =>
      ctx.toolCatalogCache.read(mcpToolCatalogCacheKey(snapshot, server)).catch(() => undefined),
    )
    if (!cachedTools) return { type: 'grace', server, listing } satisfies ServerPlan
    const tools = toCatalogTools(ctx, snapshot, server, cachedTools, 'cached')
    yield* registerCachedTools(ctx, tools)
    return { type: 'ready', tools } satisfies ServerPlan
  })
}

/**
 * Waits a short grace for an optional server with nothing cached, then starts without it.
 *
 * Its listing carries on in the background: the next turn gets its tools, and the `mcp` gateway
 * reaches them sooner. The wait is made interruptible so its timeout can abandon it even inside
 * the runtime's uninterruptible operation boundary.
 */
function awaitWithinGrace(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  plan: Extract<ServerPlan, { readonly type: 'grace' }>,
) {
  return Effect.gen(function* () {
    const outcome = yield* Fiber.await(plan.listing).pipe(
      Effect.timeoutOption(Duration.millis(ctx.optionalStartupGraceMs)),
      Effect.interruptible,
    )
    if (Option.isSome(outcome)) {
      const exit = outcome.value
      return Exit.isSuccess(exit) && Either.isRight(exit.value) ? exit.value.right : []
    }
    const runtimeNamespace = resolveMcpRuntimeNamespace(snapshot)
    yield* addNotice(ctx, runtimeNamespace, {
      id: connectNoticeId(plan.server),
      severity: 'info',
      title: `${plan.server.name} MCP server is still connecting`,
      detail: 'This turn started without its direct tools. The next turn includes them.',
      action: 'Wait for the server to connect, or use the mcp tool to reach it sooner.',
      serverInstanceId: plan.server.instanceId,
    })
    // The listing may have finished between the timeout and the notice.
    const settled = yield* Fiber.poll(plan.listing)
    if (Option.isSome(settled)) {
      yield* removeNotice(ctx, runtimeNamespace, connectNoticeId(plan.server))
    }
    return []
  })
}

function resolvePlan(ctx: RuntimeStateContext, snapshot: McpTurnSnapshot, plan: ServerPlan) {
  if (plan.type === 'ready') return Effect.succeed(plan.tools)
  if (plan.type === 'grace') return awaitWithinGrace(ctx, snapshot, plan)
  return loadServerCatalog(ctx, snapshot, plan.server).pipe(
    Effect.catchAll((error) =>
      reportServerUnavailable(ctx, snapshot, plan.server, error.message).pipe(
        Effect.as<readonly CatalogTool[]>([]),
      ),
    ),
  )
}

/**
 * The direct tools a turn registers with Pi, without letting slow servers hold the turn back.
 *
 * Per server: tools already listed this Session are used as they are; a required server is
 * waited for; an optional one starts connecting in the background and is represented by its
 * cached tool list, or, with nothing cached, waited for only a short grace.
 */
export function loadDirectToolCatalog(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  options: McpDirectToolListOptions = {},
) {
  return Effect.gen(function* () {
    yield* discardSupersededSessionConnections(ctx, snapshot)
    const servers = snapshot.servers.filter(serverRequestsDirectTools)
    const plans = yield* Effect.forEach(servers, (server) => planServer(ctx, snapshot, server), {
      concurrency: 'unbounded',
    })
    const waitingFor = plans.flatMap((plan) => (plan.type === 'ready' ? [] : [plan.server.name]))
    if (waitingFor.length > 0) options.onWaiting?.(waitingFor)
    const results = yield* Effect.forEach(plans, (plan) => resolvePlan(ctx, snapshot, plan), {
      concurrency: 'unbounded',
    })
    return results.flat()
  })
}

function inputSchemaFingerprint(tool: CatalogTool) {
  return canonicalJson(tool.tool.inputSchema ?? null)
}

/**
 * The live tool behind a handle.
 *
 * A handle a live listing produced is used directly. A handle that came from the tool list cache
 * waits for its server's live listing and is refused when the server no longer offers the tool
 * or its input schema changed, because the model built its arguments from the cached schema.
 */
export function resolveToolHandle(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  handle: string,
): Effect.Effect<CatalogTool, McpRuntimeFailure> {
  return Effect.gen(function* () {
    const known = yield* findHandle(ctx, snapshot, handle).pipe(Effect.option)
    if (Option.isSome(known) && known.value.source === 'live') return known.value
    if (Option.isNone(known)) {
      yield* loadCatalog(ctx, snapshot)
      return yield* findHandle(ctx, snapshot, handle)
    }
    const cached = known.value
    const liveTools = yield* loadServerCatalog(ctx, snapshot, cached.server)
    const live = liveTools.find((tool) => tool.handle === handle)
    if (!live) {
      return yield* Effect.fail(
        new McpStaleToolHandle({
          message: `${cached.server.name} no longer offers the MCP tool ${cached.tool.name}. Search or list tools again.`,
        }),
      )
    }
    if (inputSchemaFingerprint(live) !== inputSchemaFingerprint(cached)) {
      return yield* Effect.fail(
        new McpStaleToolHandle({
          message: `The MCP tool ${cached.tool.name} on ${cached.server.name} changed its input schema since this turn started. Describe it again for the current schema.`,
        }),
      )
    }
    return live
  })
}
