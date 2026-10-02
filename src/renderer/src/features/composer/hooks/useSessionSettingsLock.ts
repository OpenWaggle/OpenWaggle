import type { SessionId } from '@shared/types/brand'
import { useEffect } from 'react'
import { useSessionFollowUpQueue, useSessionSettingsChangeable } from '@/features/chat/hooks'
import { useChatStore } from '@/features/chat/state'
import { type SessionSettingsLock, sessionSettingsLock } from '../lib/session-settings-lock'
import { useComposerStore } from '../state/composer-store'

/**
 * The one gate for the composer's Session settings pickers (model and thinking level). It follows
 * the Host's rule from `useSessionSettingsChangeable`: locked while the Session has a Run
 * starting (a first send, a send in flight, a worktree launch, a queue action), active, or
 * finishing. `sessionId` is null for a new Session draft, locked only while its first message
 * creates the Session.
 */
export function useSessionSettingsLock(sessionId: SessionId | null): SessionSettingsLock {
  const canChange = useSessionSettingsChangeable(sessionId)
  const queue = useSessionFollowUpQueue(sessionId).snapshot
  const draftMaterializing = useChatStore((state) => state.draftSession?.isMaterializing === true)
  return sessionSettingsLock({
    hasSession: sessionId !== null,
    canChange,
    draftMaterializing: sessionId === null && draftMaterializing,
    queue,
  })
}

/**
 * Closes the thinking-level menu when the lock engages, such as a Run starting while it is open.
 * Hiding it instead would reopen it when the Run ends.
 */
export function useCloseThinkingMenuWhenLocked(locked: boolean) {
  useEffect(() => {
    if (!locked) return
    const composer = useComposerStore.getState()
    if (composer.thinkingMenuOpen) composer.openMenu(null)
  }, [locked])
}
