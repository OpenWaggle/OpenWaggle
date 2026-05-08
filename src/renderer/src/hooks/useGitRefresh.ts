import type { SessionId } from '@shared/types/brand'
import { useEffect } from 'react'
import { isTerminalTransportEvent } from '@/lib/agent-stream-utils'
import { api } from '@/lib/ipc'
import { useUIStore } from '@/stores/ui-store'

const DELAY_MS = 500

interface UseGitRefreshOptions {
  readonly projectPath: string | null
  readonly activeSessionId: SessionId | null
  readonly refreshGitStatus: (projectPath: string | null) => Promise<void>
  readonly refreshGitBranches: (projectPath: string | null) => Promise<void>
  readonly refreshSession: (id: SessionId) => Promise<void>
}

/**
 * Subscribes to agent runtime events and window focus to trigger
 * debounced git status/branch refreshes and diff-panel re-fetches.
 */
export function useGitRefresh({
  projectPath,
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
      if (projectPath) {
        if (refreshTimer) clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => {
          refreshTimer = null
          void Promise.all([refreshGitStatus(projectPath), refreshGitBranches(projectPath)])
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
    projectPath,
    refreshSession,
    refreshGitBranches,
    refreshGitStatus,
  ])

  // Refresh git status + diff panel when window regains focus
  useEffect(() => {
    function handleFocus() {
      if (projectPath) {
        void Promise.all([refreshGitStatus(projectPath), refreshGitBranches(projectPath)])
        bumpDiffRefreshKey()
      }
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [bumpDiffRefreshKey, projectPath, refreshGitBranches, refreshGitStatus])
}
