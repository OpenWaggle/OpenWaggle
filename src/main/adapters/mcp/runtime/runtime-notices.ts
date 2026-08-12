import type { McpRuntimeNotice } from '@shared/types/mcp'
import { Effect, Ref } from 'effect'
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
