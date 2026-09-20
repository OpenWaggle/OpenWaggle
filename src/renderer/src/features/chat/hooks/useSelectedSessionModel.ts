import type { SupportedModelId } from '@shared/types/llm'
import { useChatStore } from '@/features/chat/state'
import { refreshSessionStoreForSession } from '@/features/chat/state/chat-store-helpers'
import { useDraftSelectedModelStore } from '@/features/chat/state/draft-selected-model-store'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { clearDesiredSessionModel, markDesiredSessionModel } from '@/shared/lib/session-model-pick'

const logger = createRendererLogger('session-model')

/** One settled pick at a time per session, so overlapping writes reconcile in dispatch order. */
const pickQueues = new Map<string, Promise<void>>()

async function runExclusive(sessionKey: string, task: () => Promise<void>): Promise<void> {
  const previous = pickQueues.get(sessionKey) ?? Promise.resolve()
  const current = previous.then(task, task)
  pickQueues.set(
    sessionKey,
    current.catch(() => undefined),
  )
  await current
}

/**
 * The model of the session the composer is acting on — stored per session in the database, never
 * globally. Resolution order: the session's own pick, then an explicit pre-first-send draft pick,
 * then the global default (which is only a default for sessions that never picked).
 */
export function useSelectedSessionModel(): {
  readonly selectedModel: SupportedModelId
  readonly setSelectedModel: (model: SupportedModelId) => Promise<void>
} {
  const activeSession = useChatStore((s) => s.activeSession)
  const draftProjectPath = useChatStore((s) => s.draftSession?.projectPath ?? null)
  const fallbackModel = usePreferencesStore((s) => s.settings.selectedModel)

  // Draft picks apply only while no session is active: the draft is the composer's target until
  // the first send creates the session, whose own row (or the global default) takes over. A pick
  // made in an abandoned draft must not leak into an existing session that never picked.
  const draftModel = useDraftSelectedModelStore((s) =>
    activeSession === null && draftProjectPath
      ? s.byProjectPath[draftProjectPath]?.model
      : undefined,
  )

  const selectedModel = activeSession
    ? (activeSession.selectedModel ?? fallbackModel)
    : (draftModel ?? fallbackModel)

  const setSelectedModel = async (model: SupportedModelId) => {
    const state = useChatStore.getState()
    if (state.activeSessionId) {
      const sessionId = state.activeSessionId
      const session = state.activeSession
      const sessionKey = String(sessionId)
      const pickGeneration = markDesiredSessionModel(sessionKey, model)
      // Optimistic: the picker closes before the IPC write lands and the send gate reads the
      // chat store, so an awaited write would let an immediate submit dispatch the previous
      // model. The summary is patched too: branch navigation reads the summaries, not the detail.
      if (session) state.upsertSession({ ...session, selectedModel: model })
      useSessionStore.setState((s) => ({
        sessions: s.sessions.map((summary) =>
          String(summary.id) === sessionKey ? { ...summary, selectedModel: model } : summary,
        ),
      }))
      await runExclusive(sessionKey, async () => {
        try {
          await api.setSessionSelectedModel(sessionId, model)
        } catch (error) {
          logger.warn('Session model selection failed; reloading persisted state', {
            model: String(model),
            error: String(error),
          })
          // Drop this pick's guard so the reload writes the persisted row; a newer pick's guard
          // stays and keeps its optimistic value through the reload.
          clearDesiredSessionModel(sessionKey, pickGeneration)
          // Converge inside the queue, so a newer pick cannot start from a cache this failed
          // write is about to overwrite.
          await useChatStore.getState().refreshSession(sessionId)
          return
        }
        // Late detail/summary refreshes are reconciled by the guard, not here. Sync the
        // projection (and the tree when this is the open session) so readers leave the stale row.
        refreshSessionStoreForSession(sessionId, useChatStore.getState().activeSessionId)
      })
      return
    }
    const draftProject = state.draftSession?.projectPath
    if (draftProject) {
      useDraftSelectedModelStore.getState().setOverride(draftProject, model)
      return
    }
    logger.warn('Ignored model selection outside any session or draft', {
      model: String(model),
    })
  }

  return { selectedModel, setSelectedModel }
}
