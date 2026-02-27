import { useEffect } from 'react'
import { useChat } from '@/hooks/useChat'
import { useGit } from '@/hooks/useGit'
import { useGitRefresh } from '@/hooks/useGitRefresh'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useProject } from '@/hooks/useProject'
import { useUIStore } from '@/stores/ui-store'

export function useWorkspaceLifecycle(): void {
  const { projectPath } = useProject()
  const { activeConversationId, createConversation, loadConversations, setActiveConversation } =
    useChat()
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

  useGitRefresh({
    projectPath,
    activeConversationId,
    refreshGitStatus,
    refreshGitBranches,
    loadConversations,
    setActiveConversation,
  })

  useKeyboardShortcuts([
    { key: 'j', ctrl: true, action: toggleTerminal },
    { key: 'n', ctrl: true, action: () => void createConversation(projectPath) },
    { key: 'b', ctrl: true, action: toggleSidebar },
    { key: 'd', ctrl: true, action: toggleDiffPanel },
    { key: 'k', ctrl: true, action: toggleCommandPalette },
  ])
}
