import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentCompactionStatus } from '@/features/chat/lib/compaction-lifecycle'

interface RenderSnapshot {
  readonly messages: readonly UIMessage[]
  readonly compactionStatus: AgentCompactionStatus | null
  readonly updatedAt: number
}

interface RenderSnapshotState {
  readonly renderSnapshotsBySessionId: Map<SessionId, RenderSnapshot>
}

export function withRunCompactionStatus(
  state: RenderSnapshotState,
  id: SessionId,
  status: AgentCompactionStatus | null,
  active: boolean,
) {
  const existing = state.renderSnapshotsBySessionId.get(id)
  if (!existing) return state
  const next = new Map(state.renderSnapshotsBySessionId)
  if (status === null && !active) {
    next.delete(id)
    return { renderSnapshotsBySessionId: next }
  }
  next.set(id, { ...existing, compactionStatus: status, updatedAt: Date.now() })
  return { renderSnapshotsBySessionId: next }
}

export function withoutRunRenderSnapshot(state: RenderSnapshotState, id: SessionId) {
  if (!state.renderSnapshotsBySessionId.has(id)) return state
  const next = new Map(state.renderSnapshotsBySessionId)
  next.delete(id)
  return { renderSnapshotsBySessionId: next }
}
