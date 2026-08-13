import type { SessionId } from '@shared/types/brand'
import { useEffect } from 'react'
import { isTerminalTransportEvent } from '@/features/chat/lib'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'

const DELAY_MS = 500

interface UseGitRefreshOptions {
  /** Working tree whose status is refreshed: the active session's Session worktree in worktree mode. */
  readonly workingPath: string | null
  /** Repository the branch list belongs to. */
  readonly repositoryPath: string | null
  readonly activeSessionId: SessionId | null
  readonly refreshGitStatus: (workingPath: string | null) => Promise<void>
  readonly refreshGitBranches: (repositoryPath: string | null) => Promise<void>
  readonly refreshSession: (id: SessionId) => Promise<void>
}

/**
 * Subscribes to agent runtime events and window focus to trigger debounced git
 * status/branch refreshes and diff-panel re-fetches.
 *
 * This is what makes the agent's work appear without the user asking: a terminal
 * transport event means a turn finished, so whatever the agent did to the working
 * tree is now visible. Status refreshes the **working path** and the branch list the
 * repository path — refreshing status for the project would report on the primary
 * checkout while the agent was editing a Session worktree (ADR 0016).
 */
export function useGitRefresh({
  workingPath,
  repositoryPath,
  activeSessionId,
  refreshGitStatus,
  refreshGitBranches,
  refreshSession,
}: UseGitRefreshOptions): void {
  const bumpDiffRefreshKey = useUIStore((s) => s.bumpDiffRefreshKey)

  // Debounced git refresh for runtime events
  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    const unsubscribe = api.onAgentEvent(({ sessionId, event }) => {
      if (!isTerminalTransportEvent(event)) return

      if (activeSessionId === sessionId) {
        void refreshSession(activeSessionId)
      }
      if (workingPath !== null || repositoryPath !== null) {
        if (refreshTimer) clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => {
          refreshTimer = null
          void Promise.all([refreshGitStatus(workingPath), refreshGitBranches(repositoryPath)])
          bumpDiffRefreshKey()
        }, DELAY_MS)
      }
    })

    return () => {
      unsubscribe()
      if (refreshTimer) clearTimeout(refreshTimer)
    }
  }, [
    activeSessionId,
    bumpDiffRefreshKey,
    workingPath,
    repositoryPath,
    refreshSession,
    refreshGitBranches,
    refreshGitStatus,
  ])

  // Refresh git status + diff panel when window regains focus
  useEffect(() => {
    function handleFocus() {
      if (workingPath === null && repositoryPath === null) return
      void Promise.all([refreshGitStatus(workingPath), refreshGitBranches(repositoryPath)])
      bumpDiffRefreshKey()
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [bumpDiffRefreshKey, workingPath, repositoryPath, refreshGitBranches, refreshGitStatus])
}
