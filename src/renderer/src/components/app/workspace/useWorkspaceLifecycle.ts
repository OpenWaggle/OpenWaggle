import { useEffect } from 'react'
import { useChat } from '@/hooks/useChat'
import { useGit } from '@/hooks/useGit'
import { useGitRefresh } from '@/hooks/useGitRefresh'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useProject } from '@/hooks/useProject'
import { useThreadStatusMonitor } from '@/hooks/useThreadStatusMonitor'
import { api } from '@/lib/ipc'
import { useUIStore } from '@/stores/ui-store'

export function useWorkspaceLifecycle(): void {
  const { projectPath } = useProject()
  const {
    activeConversationId,
    startDraftThread,
    loadConversations,
    setActiveConversation,
    updateConversationTitle,
  } = useChat()
  const { refreshStatus: refreshGitStatus, refreshBranches: refreshGitBranches } = useGit()

  const toggleTerminal = useUIStore((s) => s.toggleTerminal)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const toggleDiffPanel = useUIStore((s) => s.toggleDiffPanel)
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette)

  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

  useEffect(() => {
    void refreshGitStatus(projectPath)
    void refreshGitBranches(projectPath)
  }, [projectPath, refreshGitStatus, refreshGitBranches])

  // Subscribe to LLM-generated title updates from main process
  useEffect(() => {
    return api.onConversationTitleUpdated(({ conversationId, title }) => {
      updateConversationTitle(conversationId, title)
    })
  }, [updateConversationTitle])

  useGitRefresh({
    projectPath,
    activeConversationId,
    refreshGitStatus,
    refreshGitBranches,
    setActiveConversation,
  })

  useThreadStatusMonitor()

  useKeyboardShortcuts([
    { key: 'j', ctrl: true, action: toggleTerminal },
    { key: 'n', ctrl: true, action: startDraftThread },
    { key: 'b', ctrl: true, action: toggleSidebar },
    { key: 'd', ctrl: true, action: toggleDiffPanel },
    { key: 'k', ctrl: true, action: toggleCommandPalette },
  ])
}
