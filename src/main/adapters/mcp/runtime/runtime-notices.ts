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

/** Records that a required server could not connect, and fails the turn that needs it. */
export function failRequiredServer(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
  detail: string,
): Effect.Effect<never, McpRequiredServerUnavailable> {
  return addNotice(ctx, resolveMcpRuntimeNamespace(snapshot), {
    id: connectNoticeId(server),
    severity: 'error',
    title: `${server.name} MCP server could not connect`,
    detail,
    action: 'Run MCP doctor, review the server configuration, then retry the turn.',
    serverInstanceId: server.instanceId,
  }).pipe(
    Effect.zipRight(
      Effect.fail(
        new McpRequiredServerUnavailable({
          serverInstanceId: server.instanceId,
          serverLabel: server.name,
          detail,
          message: `Required MCP server ${server.name} could not connect: ${detail}`,
        }),
      ),
    ),
  )
}

/** Records that a server could not connect, failing the turn when the server is required. */
export function reportServerUnavailable(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
  detail: string,
): Effect.Effect<void, McpRequiredServerUnavailable> {
  if (server.definition.required) return failRequiredServer(ctx, snapshot, server, detail)
  return addNotice(ctx, resolveMcpRuntimeNamespace(snapshot), {
    id: connectNoticeId(server),
    severity: 'warning',
    title: `${server.name} MCP server could not connect`,
    detail,
    action: 'Run MCP doctor, review the server configuration, then retry the turn.',
    serverInstanceId: server.instanceId,
  })
}

/** Removes one notice object, so a later notice with the same id is never cleared by mistake. */
export function removeExactNotice(
  ctx: RuntimeStateContext,
  sessionId: string,
  notice: McpRuntimeNotice,
) {
  return Ref.update(ctx.notices, (current) => {
    const existing = current.get(sessionId)
    if (!existing?.includes(notice)) return current
    const next = new Map(current)
    const filtered = existing.filter((entry) => entry !== notice)
    if (filtered.length === 0) next.delete(sessionId)
    else next.set(sessionId, filtered)
    return next
  })
}

/** The notice about a server's connection; a successful connect clears it. */
export function connectNoticeId(server: McpTurnSnapshotServer) {
  return `runtime:${server.instanceId}:connect`
}
