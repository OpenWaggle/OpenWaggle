import type {
  ActiveAgentRunInfo,
  ActiveCompactionInfo,
  ActiveRunInfo,
} from '@shared/types/background-run'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentCompactionStatus } from '@/features/chat/lib/compaction-lifecycle'
import { applyCompactionSnapshotEvent } from './background-run-compaction'

interface RunRenderSnapshot {
  readonly messages: readonly UIMessage[]
  readonly compactionStatus: AgentCompactionStatus | null
  readonly updatedAt: number
}

interface RunRenderState {
  readonly renderSnapshotsBySessionId: ReadonlyMap<SessionId, RunRenderSnapshot>
}

export function isAgentRun(activity: ActiveRunInfo): activity is ActiveAgentRunInfo {
  return activity.activity === 'agent-run'
}

export function isActiveCompaction(activity: ActiveRunInfo): activity is ActiveCompactionInfo {
  return activity.activity === 'compaction'
}

export function restoreCompactionSnapshots(
  state: RunRenderState,
  compactions: readonly ActiveCompactionInfo[],
) {
  const snapshots = new Map(state.renderSnapshotsBySessionId)
  for (const compaction of compactions) {
    if (snapshots.has(compaction.sessionId)) continue
    const messages: readonly UIMessage[] = []
    snapshots.set(compaction.sessionId, {
      messages,
      compactionStatus: applyCompactionSnapshotEvent(
        null,
        {
          type: 'compaction_start',
          reason: compaction.reason,
          timestamp: compaction.startedAt,
        },
        messages,
      ),
      updatedAt: Date.now(),
    })
  }
  return snapshots
}
