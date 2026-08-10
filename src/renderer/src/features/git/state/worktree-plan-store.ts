import type { SessionEnvironmentMode } from '@shared/types/git'
import { create } from 'zustand'

/** User overrides for a session's worktree plan, layered over the session defaults. */
export interface WorktreePlanOverride {
  readonly envMode?: SessionEnvironmentMode
  readonly baseRef?: string | null
  readonly startFromOrigin?: boolean
}

interface WorktreePlanState {
  readonly bySessionId: Record<string, WorktreePlanOverride>
  readonly setOverride: (sessionId: string, patch: WorktreePlanOverride) => void
}

/**
 * Per-session composer-strip plan overrides (WS1b). Holding these in a store
 * (rather than syncing session props into component state) keeps the strip's
 * editable selections free of a derived-state effect.
 */
export const useWorktreePlanStore = create<WorktreePlanState>()((set) => ({
  bySessionId: {},
  setOverride: (sessionId, patch) =>
    set((state) => ({
      bySessionId: {
        ...state.bySessionId,
        [sessionId]: { ...state.bySessionId[sessionId], ...patch },
      },
    })),
}))
