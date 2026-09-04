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

function rebaseRestoredRunningCompaction(
  status: AgentCompactionStatus | null,
  messageCount: number,
): AgentCompactionStatus | null {
  if (status?.type !== 'compacting' || messageCount === 0) return status
  const latest = status.timeline.at(-1)
  if (latest?.phase !== 'running' || latest.messageCountAtStart !== 0) return status
  return {
    ...status,
    timeline: status.timeline.map((item, index) =>
      index === status.timeline.length - 1 ? { ...item, messageCountAtStart: messageCount } : item,
    ),
  }
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
  next.set(id, {
    ...existing,
    compactionStatus: rebaseRestoredRunningCompaction(status, existing.messages.length),
    updatedAt: Date.now(),
  })
  return { renderSnapshotsBySessionId: next }
}

export function withoutRunRenderSnapshot(state: RenderSnapshotState, id: SessionId) {
  if (!state.renderSnapshotsBySessionId.has(id)) return state
  const next = new Map(state.renderSnapshotsBySessionId)
  next.delete(id)
  return { renderSnapshotsBySessionId: next }
}
