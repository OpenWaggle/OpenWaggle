import type { McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'
import { Effect, Ref } from 'effect'
import { resolveMcpRuntimeNamespace } from '../../../domain/mcp/runtime-namespace'
import type { McpToolCatalogScope } from '../../../ports/mcp-runtime-service'
import type { RuntimeStateContext } from './runtime-state-types'

export function connectFailureKey(runtimeNamespace: string, serverInstanceId: string) {
  return `${runtimeNamespace}\0${serverInstanceId}`
}

/**
 * Remembers that the Session could not reach a server in its current configuration.
 *
 * Kept apart from the notices, which a reconcile clears and a still-connecting notice replaces:
 * a turn must not offer a broken server's cached tools again just because its warning was
 * cleaned up. A successful connect, a changed configuration or a dispose clears it.
 */
export function recordConnectFailure(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
) {
  const key = connectFailureKey(resolveMcpRuntimeNamespace(snapshot), server.instanceId)
  return Ref.update(ctx.connectFailures, (current) => new Map(current).set(key, server.configHash))
}

export function connectFailedBefore(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
) {
  const key = connectFailureKey(resolveMcpRuntimeNamespace(snapshot), server.instanceId)
  return Ref.get(ctx.connectFailures).pipe(
    Effect.map((current) => current.get(key) === server.configHash),
  )
}

export function forgetConnectFailures(ctx: RuntimeStateContext, runtimeNamespace: string) {
  const prefix = connectFailureKey(runtimeNamespace, '')
  return Ref.update(ctx.connectFailures, (current) => {
    const next = new Map([...current].filter(([key]) => !key.startsWith(prefix)))
    return next.size === current.size ? current : next
  })
}

/**
 * Forgets remembered tool lists after a server's credentials changed or it was removed.
 *
 * The connections open now still speak for the old credentials until they close, so listings
 * over them (in flight, or later in a running turn) are marked not to be remembered either. The
 * mark is on the connection attempt, not its slot key, so a new connection on the same key starts
 * clean.
 */
export function forgetToolCatalog(ctx: RuntimeStateContext, scope: McpToolCatalogScope) {
  return Effect.gen(function* () {
    const serverInstanceId = scope === 'all-servers' ? undefined : scope.serverInstanceId
    const attempts = yield* ctx.connections.attempts(serverInstanceId)
    yield* Effect.sync(() => {
      for (const attempt of attempts) ctx.forgottenAttempts.add(attempt)
    })
    yield* Effect.promise(() =>
      serverInstanceId === undefined
        ? ctx.toolCatalogCache.forgetAll()
        : ctx.toolCatalogCache.forgetServer(serverInstanceId),
    )
  })
}
