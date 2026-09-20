import type { SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import { create } from 'zustand'
import { api } from '@/shared/lib/ipc'
import { useChatStore } from './chat-store'

interface DraftSelectedModelState {
  readonly byProjectPath: Record<string, SupportedModelId | undefined>
  readonly setOverride: (projectPath: string, model: SupportedModelId) => void
  readonly clearOverride: (projectPath: string, expected?: SupportedModelId) => void
}

/**
 * Holds only explicit pre-session model picks. An absent entry means the draft still shows the
 * global default and must not be copied onto the session during first send.
 */
export const useDraftSelectedModelStore = create<DraftSelectedModelState>()((set) => ({
  byProjectPath: {},
  setOverride: (projectPath, model) =>
    set((state) => ({ byProjectPath: { ...state.byProjectPath, [projectPath]: model } })),
  clearOverride: (projectPath, expected) =>
    set((state) => {
      if (expected !== undefined && state.byProjectPath[projectPath] !== expected) return state
      const { [projectPath]: _removed, ...rest } = state.byProjectPath
      return { byProjectPath: rest }
    }),
}))

/** Persist an explicit draft model choice before the first task is dispatched. */
export async function flushDraftSelectedModelToSession(
  projectPath: string,
  sessionId: SessionId,
): Promise<void> {
  const override = useDraftSelectedModelStore.getState().byProjectPath[projectPath]
  if (override === undefined) return

  try {
    await api.setSessionSelectedModel(sessionId, override)
  } catch (error) {
    // The row stays inheriting, so drop the pick rather than diverge: the composer, a retried
    // dispatch, and a reload would otherwise disagree about this session's model. The failure
    // propagates, aborting the first send with the draft preserved for the user to retry.
    useDraftSelectedModelStore.getState().clearOverride(projectPath, override)
    throw error
  }
  // createSession already replaced the draft with an active SessionDetail that carries no pick.
  // Mirror the persisted model into it before clearing the override, otherwise the picker, Waggle
  // status, and the usage snapshot fall back to the global default until the run refresh lands.
  const chat = useChatStore.getState()
  const created = chat.activeSession
  if (created && String(created.id) === String(sessionId)) {
    chat.upsertSession({ ...created, selectedModel: override })
  }
  useDraftSelectedModelStore.getState().clearOverride(projectPath, override)
}
