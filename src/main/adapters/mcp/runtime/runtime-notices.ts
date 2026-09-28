import type { McpRuntimeNotice, McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'
import { Effect, Ref } from 'effect'
import { resolveMcpRuntimeNamespace } from '../../../domain/mcp/runtime-namespace'
import { McpRequiredServerUnavailable } from '../../../ports/mcp-errors'
import type { RuntimeStateContext } from './runtime-state-types'

export function addNotice(ctx: RuntimeStateContext, sessionId: string, notice: McpRuntimeNotice) {
  return Ref.update(ctx.notices, (current) => {
    const existing = current.get(sessionId) ?? []
    return new Map(current).set(sessionId, [
      ...existing.filter((entry) => entry.id !== notice.id),
      notice,
    ])
  })
}

export function removeNotice(ctx: RuntimeStateContext, sessionId: string, noticeId: string) {
  return Ref.update(ctx.notices, (current) => {
    const existing = current.get(sessionId)
    if (!existing) return current
    const next = new Map(current)
    const filtered = existing.filter((entry) => entry.id !== noticeId)
    if (filtered.length === 0) next.delete(sessionId)
    else next.set(sessionId, filtered)
    return next
  })
}

export function getNotices(ctx: RuntimeStateContext, sessionId?: string | null) {
  return Ref.get(ctx.notices).pipe(
    Effect.map((current) =>
      sessionId ? (current.get(sessionId) ?? []) : [...current.values()].flat(),
    ),
  )
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
