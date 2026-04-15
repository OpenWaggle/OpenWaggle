import { useEffect } from 'react'
import { useChat } from '@/hooks/useChat'
import { useGit } from '@/hooks/useGit'
import { useGitRefresh } from '@/hooks/useGitRefresh'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useProject } from '@/hooks/useProject'
import { useThreadStatusMonitor } from '@/hooks/useThreadStatusMonitor'
import { api } from '@/lib/ipc'
import { initContextSnapshotListener, useContextStore } from '@/stores/context-store'
import { usePreferencesStore } from '@/stores/preferences-store'
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

  // Context snapshot: subscribe to main-process pushes
  useEffect(() => {
    return initContextSnapshotListener()
  }, [])

  // Context snapshot: sync active conversation and re-fetch on model change
  const setContextActiveConversation = useContextStore((s) => s.setActiveConversation)
  const selectedModel = usePreferencesStore((s) => s.settings.selectedModel)
  useEffect(() => {
    // Re-fetch snapshot when conversation or model changes.
    // selectedModel is read to trigger re-fetch on model switch.
    void selectedModel
    setContextActiveConversation(activeConversationId ?? null)
  }, [activeConversationId, selectedModel, setContextActiveConversation])

  useKeyboardShortcuts([
    { key: 'j', ctrl: true, action: toggleTerminal },
    { key: 'n', ctrl: true, action: startDraftThread },
    { key: 'b', ctrl: true, action: toggleSidebar },
    { key: 'd', ctrl: true, action: toggleDiffPanel },
    { key: 'k', ctrl: true, action: toggleCommandPalette },
  ])
}
