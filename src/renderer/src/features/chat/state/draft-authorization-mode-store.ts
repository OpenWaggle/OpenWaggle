import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { SessionId } from '@shared/types/brand'
import { create } from 'zustand'
import { api } from '@/shared/lib/ipc'

interface DraftAuthorizationModeState {
  readonly byProjectPath: Record<string, AgentAuthorizationMode | undefined>
  readonly setOverride: (projectPath: string, mode: AgentAuthorizationMode | null) => void
  readonly clearOverride: (projectPath: string, expected?: AgentAuthorizationMode) => void
}

/**
 * Holds only explicit pre-session choices. An absent entry means the draft still inherits the
 * project/global default and must not be copied onto the session during first send.
 */
export const useDraftAuthorizationModeStore = create<DraftAuthorizationModeState>()((set) => ({
  byProjectPath: {},
  setOverride: (projectPath, mode) =>
    set((state) => {
      if (mode === null) {
        const { [projectPath]: _removed, ...rest } = state.byProjectPath
        return { byProjectPath: rest }
      }
      return { byProjectPath: { ...state.byProjectPath, [projectPath]: mode } }
    }),
  clearOverride: (projectPath, expected) =>
    set((state) => {
      if (expected !== undefined && state.byProjectPath[projectPath] !== expected) return state
      const { [projectPath]: _removed, ...rest } = state.byProjectPath
      return { byProjectPath: rest }
    }),
}))

/** Persist an explicit draft choice before the first task is dispatched. */
export async function flushDraftAuthorizationModeToSession(
  projectPath: string,
  sessionId: SessionId,
): Promise<void> {
  const override = useDraftAuthorizationModeStore.getState().byProjectPath[projectPath]
  if (override === undefined) return

  await api.setSessionAuthorizationMode(sessionId, override)
  useDraftAuthorizationModeStore.getState().clearOverride(projectPath, override)
}
