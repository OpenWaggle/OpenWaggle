import type { SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import { create } from 'zustand'
import { useSessionStore } from '@/features/sessions/state'
import { api } from '@/shared/lib/ipc'
import {
  clearDesiredSessionModel,
  commitDesiredSessionModel,
  markDesiredSessionModel,
  peekDesiredSessionModel,
  reconcileSessionModelPick,
  runExclusiveSessionModelWrite,
} from '@/shared/lib/session-model-pick'
import { useChatStore } from './chat-store'

interface DraftModelOverride {
  readonly model: SupportedModelId
  /**
   * Identifies one act of picking. A same-valued re-pick in a newer draft must not be cleared by
   * an older send's cleanup, so clearing compares generations, not model values.
   */
  readonly generation: number
}

interface DraftSelectedModelState {
  readonly byProjectPath: Record<string, DraftModelOverride | undefined>
  readonly setOverride: (projectPath: string, model: SupportedModelId) => void
  readonly clearOverride: (projectPath: string, generation: number) => void
}

let nextGeneration = 0

/**
 * Holds only explicit pre-session model picks. An absent entry means the draft still shows the
 * global default and must not be copied onto the session during first send.
 */
export const useDraftSelectedModelStore = create<DraftSelectedModelState>()((set) => ({
  byProjectPath: {},
  setOverride: (projectPath, model) =>
    set((state) => ({
      byProjectPath: {
        ...state.byProjectPath,
        [projectPath]: { model, generation: ++nextGeneration },
      },
    })),
  clearOverride: (projectPath, generation) =>
    set((state) => {
      const current = state.byProjectPath[projectPath]
      if (!current || current.generation !== generation) return state
      const { [projectPath]: _removed, ...rest } = state.byProjectPath
      return { byProjectPath: rest }
    }),
}))

/**
 * Promotes an explicit draft pick onto the freshly created session immediately, before the
 * awaited worktree/authorization setup: the resolution hook reads the active session (not the
 * draft) once the session id exists, so an unpromoted pick would resolve the global default and
 * a parallel submit could dispatch it. Persistence still goes through the queued flush.
 */
export function applyDraftSelectedModelToSession(
  sessionId: SessionId,
  override: DraftModelOverride | undefined,
): number | undefined {
  if (override === undefined) return undefined
  const sessionKey = String(sessionId)
  const generation = markDesiredSessionModel(sessionKey, override.model)
  const created = useChatStore.getState().activeSession
  if (created && String(created.id) === sessionKey) {
    useChatStore.getState().upsertSession({ ...created, selectedModel: override.model })
  }
  useSessionStore.setState((state) => ({
    sessions: state.sessions.map((summary) =>
      String(summary.id) === sessionKey ? { ...summary, selectedModel: override.model } : summary,
    ),
  }))
  return generation
}

/**
 * Undoes a promotion whose send failed before the pick was persisted, so the caches never keep
 * a model the database does not have. A newer pick's guard survives the rollback.
 */
export function undoDraftSelectedModelPromotion(sessionId: SessionId, generation: number): void {
  const sessionKey = String(sessionId)
  clearDesiredSessionModel(sessionKey, generation)
  // The user may have navigated away while setup was pending: roll the cached row back by id,
  // so a later setActiveSession cannot reuse the unpersisted pick. upsertSession also updates
  // activeSession when the ids match.
  const cached = useChatStore.getState().sessionById.get(sessionId)
  if (cached) {
    useChatStore.getState().upsertSession({ ...cached, selectedModel: undefined })
  }
  useSessionStore.setState((state) => ({
    sessions: state.sessions.map((summary) =>
      String(summary.id) === sessionKey
        ? reconcileSessionModelPick({ ...summary, selectedModel: undefined })
        : summary,
    ),
  }))
}

/** Read the explicit pre-first-send pick without touching it, so it survives the send's awaits. */
export function snapshotDraftSelectedModel(projectPath: string): DraftModelOverride | undefined {
  return useDraftSelectedModelStore.getState().byProjectPath[projectPath]
}

/** Persist an explicit draft model choice before the first task is dispatched. */
export async function flushDraftSelectedModelToSession(
  projectPath: string,
  sessionId: SessionId,
  override: DraftModelOverride | undefined,
): Promise<void> {
  if (override === undefined) return

  const sessionKey = String(sessionId)
  // The picker stays enabled once createSession activates the session, so a newer pick can be
  // queued behind or ahead of this flush; the shared per-session queue orders them, and the
  // guard keeps the newest pick through any refresh that read the row earlier.
  await runExclusiveSessionModelWrite(sessionKey, async () => {
    // A pick made on the live session while the first send was awaiting setup supersedes this
    // snapshot when it chose a different model — queue order alone cannot tell intent, since this
    // flush was enqueued earlier. The promotion's pre-mark holds our own value and still persists.
    const desired = peekDesiredSessionModel(sessionKey)
    if (desired !== undefined && desired !== override.model) {
      useDraftSelectedModelStore.getState().clearOverride(projectPath, override.generation)
      return
    }
    const pickGeneration = markDesiredSessionModel(sessionKey, override.model)
    try {
      await api.setSessionSelectedModel(sessionId, override.model)
      commitDesiredSessionModel(sessionKey, override.model, pickGeneration)
    } catch (error) {
      // The row stays inheriting; the failure propagates and aborts the first send. The draft
      // override is deliberately kept so a retry re-applies the model the user actually picked —
      // clearing it here silently downgraded the retry to the global default.
      clearDesiredSessionModel(sessionKey, pickGeneration)
      throw error
    }
    // createSession already replaced the draft with an active SessionDetail that carries no pick.
    // Mirror the persisted model into it before clearing the override, otherwise the picker, Waggle
    // status, and the usage snapshot fall back to the global default until the run refresh lands.
    const chat = useChatStore.getState()
    const created = chat.activeSession
    if (created && String(created.id) === String(sessionId)) {
      chat.upsertSession({ ...created, selectedModel: override.model })
    }
    useDraftSelectedModelStore.getState().clearOverride(projectPath, override.generation)
    // The pick guard stays: a refresh that read the row before the write can still land later, and
    // it must not restore the pre-pick value. A newer pick replaces the guard; a failure clears it.
  })
}
