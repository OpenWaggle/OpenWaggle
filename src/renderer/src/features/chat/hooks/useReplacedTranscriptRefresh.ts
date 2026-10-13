import type { SessionId } from '@shared/types/brand'
import type { SessionDetail, SessionWorkspace } from '@shared/types/session'
import { useEffect } from 'react'
import { useSessionStore } from '@/features/sessions/state'
import { detailReplacedWorkspaceTranscript } from '../lib/session-workspace-transcript'

/**
 * Loads the workspace again once the Session's detail replaced the transcript it shows, so the
 * open view shows the new transcript alone, as a reload does. Not while a Run is shown: its rows
 * follow the loaded workspace until the Run settles.
 */
export function useReplacedTranscriptRefresh(input: {
  readonly activeSessionId: SessionId | null
  readonly activeSession: SessionDetail | null
  readonly activeWorkspace: SessionWorkspace | null
  readonly isLoading: boolean
}) {
  const replaced = !input.isLoading && detailReplacedWorkspaceTranscript(input)
  const sessionId = input.activeSessionId
  const updatedAt = input.activeSession?.updatedAt
  useEffect(() => {
    if (!replaced || !sessionId || updatedAt === undefined) return
    void useSessionStore.getState().refreshSessionWorkspace(sessionId)
  }, [replaced, sessionId, updatedAt])
}
