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
  readonly takeOverride: (key: string) => WorktreePlanOverride | undefined
}

/** Store key for setup choices made before the user has selected a project. */
export const PROJECTLESS_DRAFT_WORKTREE_PLAN_KEY = 'draft:projectless'

/** Store key for a not-yet-created session's plan, keyed by the opened project. */
export function draftWorktreePlanKey(projectPath: string): string {
  return `draft:${projectPath}`
}

/**
 * Per-session composer-strip plan overrides (WS1b). Holding these in a store
 * (rather than syncing session props into component state) keeps the strip's
 * editable selections free of a derived-state effect.
 */
export const useWorktreePlanStore = create<WorktreePlanState>()((set, get) => ({
  bySessionId: {},
  setOverride: (sessionId, patch) =>
    set((state) => ({
      bySessionId: {
        ...state.bySessionId,
        [sessionId]: { ...state.bySessionId[sessionId], ...patch },
      },
    })),
  takeOverride: (key) => {
    const override = get().bySessionId[key]
    if (override) {
      set((state) => {
        const { [key]: _removed, ...rest } = state.bySessionId
        return { bySessionId: rest }
      })
    }
    return override
  },
}))
