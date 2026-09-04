import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import {
  type AgentCompactionStatus,
  getTimelineCompactionStatus,
} from '@/features/chat/lib/compaction-lifecycle'

interface RenderSnapshot {
  readonly messages: readonly UIMessage[]
  readonly compactionStatus: AgentCompactionStatus | null
  readonly updatedAt: number
}

interface RenderSnapshotState {
  readonly renderSnapshotsBySessionId: Map<SessionId, RenderSnapshot>
}

function rebaseRestoredCompaction(
  status: AgentCompactionStatus | null,
  messageCount: number,
): AgentCompactionStatus | null {
  if (!status || messageCount === 0) return status
  const timelineStatus = getTimelineCompactionStatus(status)
  const latest = timelineStatus?.timeline.at(-1)
  if (!timelineStatus || latest?.messageCountAtStart !== 0) return status
  const rebasedTimelineStatus = {
    ...timelineStatus,
    timeline: timelineStatus.timeline.map((item, index) =>
      index === timelineStatus.timeline.length - 1
        ? { ...item, messageCountAtStart: messageCount }
        : item,
    ),
  }
  return status.type === 'retrying'
    ? { ...status, previousCompactionStatus: rebasedTimelineStatus }
    : rebasedTimelineStatus
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
    compactionStatus: rebaseRestoredCompaction(status, existing.messages.length),
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
