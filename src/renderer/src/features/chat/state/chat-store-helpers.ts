import { SessionId } from '@shared/types/brand'
import type { SessionDetail, SessionSummary } from '@shared/types/session'
import { useSessionStore } from '@/features/sessions/state'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('chat-store')

export function toSessionId(id: SessionId) {
  return SessionId(String(id))
}

export function optionalSessionId(id: SessionId | null) {
  return id ? toSessionId(id) : null
}

export function isSameSessionId(left: SessionId | null, right: SessionId) {
  return left !== null && String(left) === String(right)
}

export function refreshSessionStoreForSession(
  sessionId: SessionId,
  activeSessionId: SessionId | null,
) {
  const sessionStore = useSessionStore.getState()
  if (isSameSessionId(activeSessionId, sessionId)) {
    void sessionStore.refreshSessionsAndTree(toSessionId(sessionId))
    return
  }

  void sessionStore.loadSessions()
}

export function handleStoreError(
  err: unknown,
  action: string,
  setError: (message: string) => void,
) {
  const message = err instanceof Error ? err.message : String(err)
  logger.error(`Failed to ${action}`, { message })
  setError(`Failed to ${action}: ${message}`)
}

export function toSummary(session: SessionDetail) {
  return {
    id: session.id,
    title: session.title,
    projectPath: session.projectPath,
    messageCount: session.messages.length,
    archived: session.archived,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

function shouldShowSummary(summary: SessionSummary) {
  return summary.title !== 'New session' || (summary.messageCount ?? 0) > 0
}

export function mergeSummary(summaries: readonly SessionSummary[], summary: SessionSummary) {
  const existingIndex = summaries.findIndex((item) => item.id === summary.id)
  if (!shouldShowSummary(summary)) {
    return existingIndex === -1
      ? [...summaries]
      : summaries.filter((item) => item.id !== summary.id)
  }

  if (existingIndex === -1) {
    return [summary, ...summaries]
  }

  return summaries.map((item) => (item.id === summary.id ? summary : item))
}

export function removeSummary(summaries: readonly SessionSummary[], id: SessionId) {
  return summaries.filter((summary) => summary.id !== id)
}
