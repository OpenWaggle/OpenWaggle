import type { ConversationId } from '@shared/types/brand'
import { useEffect, useState } from 'react'
import { api } from '@/lib/ipc'
import { isTerminalChunk } from '@/lib/ipc-connection-adapter'

interface UseGitRefreshOptions {
  readonly projectPath: string | null
  readonly activeConversationId: ConversationId | null
  readonly refreshGitStatus: (projectPath: string | null) => Promise<void>
  readonly refreshGitBranches: (projectPath: string | null) => Promise<void>
  readonly loadConversations: () => Promise<void>
  readonly setActiveConversation: (id: ConversationId | null) => Promise<void>
}

interface UseGitRefreshResult {
  readonly diffRefreshKey: number
  readonly bumpDiffRefreshKey: () => void
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
  loadConversations,
  setActiveConversation,
}: UseGitRefreshOptions): UseGitRefreshResult {
  const [diffRefreshKey, setDiffRefreshKey] = useState(0)

  function bumpDiffRefreshKey(): void {
    setDiffRefreshKey((k) => k + 1)
  }

  // Debounced git refresh for stream-chunk events
  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    const unsubscribe = api.onStreamChunk(({ conversationId, chunk }) => {
      if (!isTerminalChunk(chunk)) return

      void loadConversations()
      if (activeConversationId === conversationId) {
        void setActiveConversation(activeConversationId)
      }
      if (projectPath) {
        if (refreshTimer) clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => {
          refreshTimer = null
          void Promise.all([refreshGitStatus(projectPath), refreshGitBranches(projectPath)])
          setDiffRefreshKey((k) => k + 1)
        }, 500)
      }
    })

    return () => {
      unsubscribe()
      if (refreshTimer) clearTimeout(refreshTimer)
    }
  }, [
    activeConversationId,
    loadConversations,
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
        setDiffRefreshKey((k) => k + 1)
      }
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [projectPath, refreshGitBranches, refreshGitStatus])

  return { diffRefreshKey, bumpDiffRefreshKey }
}
