import type { ConversationId } from '@shared/types/brand'
import { useEffect } from 'react'
import { api } from '@/lib/ipc'
import { isTerminalChunk } from '@/lib/ipc-connection-adapter'
import { useUIStore } from '@/stores/ui-store'

const DELAY_MS = 500

interface UseGitRefreshOptions {
  readonly projectPath: string | null
  readonly activeConversationId: ConversationId | null
  readonly refreshGitStatus: (projectPath: string | null) => Promise<void>
  readonly refreshGitBranches: (projectPath: string | null) => Promise<void>
  readonly setActiveConversation: (id: ConversationId | null) => Promise<void>
}

/**
 * Subscribes to agent stream-chunk events and window focus to trigger
 * debounced git status/branch refreshes and diff-panel re-fetches.
 */
export function useGitRefresh({
  projectPath,
  activeConversationId,
  refreshGitStatus,
  refreshGitBranches,
  setActiveConversation,
}: UseGitRefreshOptions): void {
  const bumpDiffRefreshKey = useUIStore((s) => s.bumpDiffRefreshKey)

  // Debounced git refresh for stream-chunk events
  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    const unsubscribe = api.onStreamChunk(({ conversationId, chunk }) => {
      if (!isTerminalChunk(chunk)) return

      if (activeConversationId === conversationId) {
        void setActiveConversation(activeConversationId)
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
    activeConversationId,
    bumpDiffRefreshKey,
    projectPath,
    refreshGitBranches,
    refreshGitStatus,
    setActiveConversation,
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
