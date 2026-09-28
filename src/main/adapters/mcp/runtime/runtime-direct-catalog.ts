import type { McpRuntimeNotice, McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'
import { Deferred, Duration, Effect, Either, Exit, Fiber, Option, Ref } from 'effect'
import { serverRequestsDirectTools } from '../../../domain/mcp/direct-tool-servers'
import { resolveMcpRuntimeNamespace } from '../../../domain/mcp/runtime-namespace'
import type { McpRuntimeFailure } from '../../../ports/mcp-errors'
import type {
  McpDirectToolListOptions,
  McpDirectToolWaitOutcome,
} from '../../../ports/mcp-runtime-service'
import { discardSupersededSessionConnections } from './runtime-catalog'
import {
  addNotice,
  connectNoticeId,
  failRequiredServer,
  removeExactNotice,
  removeNotice,
  reportServerUnavailable,
} from './runtime-notices'
import {
  freshServerCatalog,
  loadServerCatalog,
  startServerListing,
  toCatalogTools,
} from './runtime-server-listing'
import type { CatalogTool, RuntimeStateContext, ServerListing } from './runtime-state-types'
import { connectFailedBefore, recordConnectFailure } from './runtime-tool-catalog-state'
import { mcpToolCatalogIdentity } from './tool-catalog-cache'

type ListingOutcome = Either.Either<readonly CatalogTool[], McpRuntimeFailure>

/**
 * A listing the turn watches from a background fiber, whether its slot was retired, and the
 * "still connecting" notice the turn posted for it, which only this listing may clear.
 */
interface WatchedListing {
  readonly fiber: Fiber.RuntimeFiber<ListingOutcome>
  readonly listing: ServerListing
  readonly posted: Ref.Ref<McpRuntimeNotice | undefined>
}

/** Clears the notice this listing's turn posted, and no later listing's. */
function clearPostedNotice(
  ctx: RuntimeStateContext,
  runtimeNamespace: string,
  posted: WatchedListing['posted'],
) {
  return Ref.get(posted).pipe(
    Effect.flatMap((notice) =>
      notice ? removeExactNotice(ctx, runtimeNamespace, notice) : Effect.void,
    ),
  )
}

/** The tools one server gave the turn, and how its wait ended when the turn waited for it. */
interface PlanResult {
  readonly tools: readonly CatalogTool[]
  readonly waited?: { readonly server: string; readonly state: keyof McpDirectToolWaitOutcome }
}

/**
 * How a turn gets one server's direct tools: the server the turn waits for, if it waits at all,
 * and the effect that produces the tools.
 */
interface ServerPlan {
  readonly waitsFor?: string
  readonly resolve: Effect.Effect<PlanResult, McpRuntimeFailure>
}

function ready(tools: readonly CatalogTool[]): ServerPlan {
  return { resolve: Effect.succeed({ tools }) }
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
 * Reports a failed background listing, unless the failure is only its slot being closed (a new
 * snapshot revision, a reconcile, a dispose) or the Session is gone. A retired listing clears the
 * "still connecting" notice its turn posted, because nothing is connecting any more.
 */
function reportBackgroundFailure(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
  watched: Pick<WatchedListing, 'listing' | 'posted'>,
  error: McpRuntimeFailure,
) {
  return Effect.gen(function* () {
    const runtimeNamespace = resolveMcpRuntimeNamespace(snapshot)
    if (watched.listing.retired.aborted) {
      return yield* clearPostedNotice(ctx, runtimeNamespace, watched.posted)
    }
    if (!(yield* namespaceIsLive(ctx, runtimeNamespace))) return
    yield* recordConnectFailure(ctx, snapshot, server)
    yield* reportServerUnavailable(ctx, snapshot, server, error.message).pipe(
      Effect.catchAll(() => Effect.void),
    )
  })
}

/**
 * Lists a server's tools on a background fiber that outlives the turn's wait for it.
 *
 * The connection is started before the fiber is forked, while the caller still holds the runtime
 * lifecycle lock, so a dispose that follows finds and retires it.
 */
function listInBackground(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
) {
  return Effect.gen(function* () {
    const listing = yield* startServerListing(ctx, snapshot, server)
    const posted = yield* Ref.make<McpRuntimeNotice | undefined>(undefined)
    const runtimeNamespace = resolveMcpRuntimeNamespace(snapshot)
    const fiber = yield* Effect.forkDaemon(
      Deferred.await(listing.result).pipe(
        Effect.tap(() =>
          listing.retired.aborted
            ? clearPostedNotice(ctx, runtimeNamespace, posted)
            : removeNotice(ctx, runtimeNamespace, connectNoticeId(server)),
        ),
        Effect.tapError((error) =>
          reportBackgroundFailure(ctx, snapshot, server, { listing, posted }, error),
        ),
        Effect.either,
      ),
    )
    return { fiber, listing, posted } satisfies WatchedListing
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

function readCachedTools(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
) {
  return Effect.promise(() =>
    ctx.toolCatalogCache.read(mcpToolCatalogIdentity(snapshot, server)).catch(() => undefined),
  )
}

function planServer(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
) {
  return Effect.gen(function* () {
    const fresh = yield* freshServerCatalog(ctx, snapshot, server)
    if (fresh) return ready(fresh)
    // A required server gates the turn (ADR 0013), so it is never stood in for by the cache.
    if (server.definition.required) {
      return { waitsFor: server.name, resolve: awaitRequired(ctx, snapshot, server) }
    }
    // Offering cached tools of a server that just failed would only fail each call, late.
    const failedBefore = yield* connectFailedBefore(ctx, snapshot, server)
    const watched = yield* listInBackground(ctx, snapshot, server)
    const cachedTools = failedBefore ? undefined : yield* readCachedTools(ctx, snapshot, server)
    if (!cachedTools) {
      return { waitsFor: server.name, resolve: awaitWithinGrace(ctx, snapshot, server, watched) }
    }
    const tools = toCatalogTools(ctx, snapshot, server, cachedTools, 'cached')
    yield* registerCachedTools(ctx, tools)
    return ready(tools)
  })
}

/** Shows that the turn went ahead while the server keeps connecting, without hiding a failure. */
function noteStillConnecting(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
  watched: WatchedListing,
) {
  return Effect.gen(function* () {
    const runtimeNamespace = resolveMcpRuntimeNamespace(snapshot)
    const notice: McpRuntimeNotice = {
      id: connectNoticeId(server),
      severity: 'info',
      title: `${server.name} MCP server is still connecting`,
      detail: 'This turn started without its direct tools. The next turn includes them.',
      action: 'Wait for the server to connect, or use the mcp tool to reach it sooner.',
      serverInstanceId: server.instanceId,
    }
    yield* addNotice(ctx, runtimeNamespace, notice)
    yield* Ref.set(watched.posted, notice)
    // The listing may have settled between the timeout and the notice, which would replace its
    // own report; restore the outcome it had.
    const settled = yield* Fiber.poll(watched.fiber)
    if (Option.isNone(settled)) return
    const outcome = settled.value
    if (Exit.isSuccess(outcome) && Either.isLeft(outcome.value)) {
      return yield* reportBackgroundFailure(ctx, snapshot, server, watched, outcome.value.left)
    }
    yield* clearPostedNotice(ctx, runtimeNamespace, watched.posted)
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
  target: McpTurnSnapshotServer,
  watched: WatchedListing,
) {
  return Effect.gen(function* () {
    const server = target.name
    const outcome = yield* Fiber.await(watched.fiber).pipe(
      Effect.timeoutOption(Duration.millis(ctx.optionalStartupGraceMs)),
      Effect.interruptible,
    )
    if (Option.isSome(outcome)) {
      const exit = outcome.value
      return Exit.isSuccess(exit) && Either.isRight(exit.value)
        ? ({ tools: exit.value.right, waited: { server, state: 'connected' } } satisfies PlanResult)
        : ({ tools: [], waited: { server, state: 'unavailable' } } satisfies PlanResult)
    }
    yield* noteStillConnecting(ctx, snapshot, target, watched)
    return { tools: [], waited: { server, state: 'stillConnecting' } } satisfies PlanResult
  })
}

function awaitRequired(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
) {
  return loadServerCatalog(ctx, snapshot, server).pipe(
    Effect.map(
      (tools): PlanResult => ({ tools, waited: { server: server.name, state: 'connected' } }),
    ),
    Effect.catchAll((error) => failRequiredServer(ctx, snapshot, server, error.message)),
  )
}

function waitOutcome(results: readonly PlanResult[]): McpDirectToolWaitOutcome {
  const servers = (state: keyof McpDirectToolWaitOutcome) =>
    results.flatMap((result) => (result.waited?.state === state ? [result.waited.server] : []))
  return {
    connected: servers('connected'),
    stillConnecting: servers('stillConnecting'),
    unavailable: servers('unavailable'),
  }
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
    const waitingFor = plans.flatMap((plan) => (plan.waitsFor ? [plan.waitsFor] : []))
    if (waitingFor.length > 0) options.onWaiting?.(waitingFor)
    const results = yield* Effect.forEach(plans, (plan) => plan.resolve, {
      concurrency: 'unbounded',
    })
    if (waitingFor.length > 0) options.onWaitSettled?.(waitOutcome(results))
    return results.flatMap((result) => result.tools)
  })
}
