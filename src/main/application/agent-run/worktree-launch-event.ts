import {
  WORKTREE_CREATED_CUSTOM_EVENT,
  type WorktreeLaunchProgress,
} from '@shared/types/background-run'
import type { DurableAgentLoopEvent } from './agent-loop-events'

/** Collect first-send launch progress and expose the compact event persisted with the completed turn. */
export function createWorktreeLaunchEventCollector() {
  const details: string[] = []
  const detailSet = new Set<string>()
  let createdEvent: DurableAgentLoopEvent | null = null

  return {
    record(progress: WorktreeLaunchProgress) {
      for (const detail of progress.details) {
        if (detailSet.has(detail)) continue
        detailSet.add(detail)
        details.push(detail)
      }
      if (progress.stage !== 'worktree-created') return

      createdEvent = {
        type: 'custom',
        name: WORKTREE_CREATED_CUSTOM_EVENT,
        timestamp: Date.now(),
        value: {
          stage: 'starting-task',
          status: 'complete',
          details: [...details],
          ...(progress.worktreePath ? { worktreePath: progress.worktreePath } : {}),
          ...(progress.branch ? { branch: progress.branch } : {}),
          ...(progress.baseRef ? { baseRef: progress.baseRef } : {}),
        },
      }
    },
    createdEvent() {
      return createdEvent
    },
  }
}
