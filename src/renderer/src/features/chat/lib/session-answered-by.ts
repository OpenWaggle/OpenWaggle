import type { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import {
  isModelActionable,
  latestAnsweringModel,
  modelActionError,
} from '@/features/providers/state'
import { useChatStore } from '../state/chat-store'

/**
 * Why a Session cannot send on `model`, counting the fallback its Runs would take: a model the
 * catalog lacks runs on the model that answered the Session last.
 */
export function sessionModelActionError(
  session: SessionDetail | null,
  model: SupportedModelId | undefined,
) {
  return modelActionError(model, latestAnsweringModel(session?.messages ?? []))
}

function loadedSession(sessionId: SessionId) {
  const { sessionById, activeSession } = useChatStore.getState()
  return sessionById.get(sessionId) ?? (activeSession?.id === sessionId ? activeSession : null)
}

/**
 * Whether a Session can act on `model`: send, switch branches, navigate or compact. A fork or
 * clone runs no model of the renderer's, so it does not ask.
 * Like a send, each falls back on the Host to the model that answered last when `model` is gone.
 * Takes the Session itself, such as a detail just fetched, or its id to read the loaded one.
 */
export function isSessionModelActionable(
  session: SessionId | Pick<SessionDetail, 'messages'> | null | undefined,
  model: SupportedModelId | undefined,
): model is SupportedModelId {
  const detail = typeof session === 'string' ? loadedSession(session) : session
  return isModelActionable(model, latestAnsweringModel(detail?.messages ?? []))
}
