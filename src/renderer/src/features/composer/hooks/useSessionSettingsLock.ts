import type { SessionId } from '@shared/types/brand'
import { useSessionFollowUpQueue, useSessionThinkingLevel } from '@/features/chat/hooks'
import { type SessionSettingsLock, sessionSettingsLock } from '../lib/session-settings-lock'

/**
 * The one gate for the composer's Session settings pickers (model and thinking level). It follows
 * the Host's rule from `useSessionThinkingLevel().canChange`, which model changes share: locked
 * while the Session has a Run starting, active, or finishing. `sessionId` is null for a new
 * Session draft, which is never locked.
 */
export function useSessionSettingsLock(sessionId: SessionId | null): SessionSettingsLock {
  const { canChange } = useSessionThinkingLevel(sessionId)
  const queue = useSessionFollowUpQueue(sessionId).snapshot
  return sessionSettingsLock({ hasSession: sessionId !== null, canChange, queue })
}
