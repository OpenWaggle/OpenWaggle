import { SessionId } from '@shared/types/brand'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useChat } from '@/hooks/useChat'
import { useDiffRouteNavigation } from '@/hooks/useDiffRouteNavigation'
import { useGit } from '@/hooks/useGit'
import { useGitRefresh } from '@/hooks/useGitRefresh'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useProject } from '@/hooks/useProject'
import { useSessionStatusMonitor } from '@/hooks/useSessionStatusMonitor'
import { useSessions } from '@/hooks/useSessions'
import { api } from '@/lib/ipc'
import { useUIStore } from '@/stores/ui-store'

export function useWorkspaceLifecycle(): void {
  const { projectPath } = useProject()
  const {
    activeConversationId,
    startDraftSession,
    loadConversations,
    refreshConversation,
    updateConversationTitle,
  } = useChat()
  const { loadSessions, refreshSessionTree } = useSessions()
  const { refreshStatus: refreshGitStatus, refreshBranches: refreshGitBranches } = useGit()

  const navigate = useNavigate()
  const toggleTerminal = useUIStore((s) => s.toggleTerminal)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette)
  const { toggleDiff } = useDiffRouteNavigation()

  function startDraftSessionRoute(): void {
    startDraftSession()
    void navigate({ to: '/' })
  }

  useEffect(() => {
    void loadConversations()
    void loadSessions()
  }, [loadConversations, loadSessions])

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
    refreshConversation,
  })

  useEffect(() => {
    void refreshSessionTree(activeConversationId ? SessionId(String(activeConversationId)) : null)
  }, [activeConversationId, refreshSessionTree])

  useSessionStatusMonitor()

  useKeyboardShortcuts([
    { key: 'j', ctrl: true, action: toggleTerminal },
    { key: 'n', ctrl: true, action: startDraftSessionRoute },
    { key: 'b', ctrl: true, action: toggleSidebar },
    { key: 'd', ctrl: true, action: toggleDiff },
    { key: 'k', ctrl: true, action: toggleCommandPalette },
  ])
}
