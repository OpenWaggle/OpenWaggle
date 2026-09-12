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
  let createdAt: number | null = null
  let worktreePath: string | undefined
  let branch: string | undefined
  let baseRef: string | undefined
  let setupAction: WorktreeLaunchProgress['setupAction']

  return {
    record(progress: WorktreeLaunchProgress) {
      for (const detail of progress.details) {
        if (detailSet.has(detail)) continue
        detailSet.add(detail)
        details.push(detail)
      }
      if (progress.worktreePath !== undefined) worktreePath = progress.worktreePath
      if (progress.branch !== undefined) branch = progress.branch
      if (progress.baseRef !== undefined) baseRef = progress.baseRef
      if (progress.setupAction !== undefined) setupAction = progress.setupAction
      if (progress.stage === 'worktree-created' && createdAt === null) createdAt = Date.now()
      if (createdAt === null) return

      createdEvent = {
        type: 'custom',
        name: WORKTREE_CREATED_CUSTOM_EVENT,
        timestamp: createdAt,
        value: {
          stage: 'starting-task',
          status: 'complete',
          details: [...details],
          ...(worktreePath ? { worktreePath } : {}),
          ...(branch ? { branch } : {}),
          ...(baseRef ? { baseRef } : {}),
          ...(setupAction ? { setupAction } : {}),
        },
      }
    },
    createdEvent() {
      return createdEvent
    },
  }
}
