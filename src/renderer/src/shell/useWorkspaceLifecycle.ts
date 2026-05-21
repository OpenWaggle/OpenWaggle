import { SessionId } from '@shared/types/brand'
import { useHotkeys } from '@tanstack/react-hotkeys'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useChat } from '@/features/chat/hooks'
import { useDiffRouteNavigation } from '@/features/diff-panel/hooks'
import { useGit, useGitRefresh } from '@/features/git/hooks'
import { useProject, useSessionStatusMonitor, useSessions } from '@/features/sessions/hooks'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'

export function useWorkspaceLifecycle(): void {
  const { projectPath } = useProject()
  const {
    activeSessionId,
    startDraftSession,
    loadSessions: loadChatSessions,
    refreshSession,
    updateSessionTitle,
  } = useChat()
  const { loadSessions: loadSessionTrees, refreshSessionTree } = useSessions()
  const { refreshStatus: refreshGitStatus, refreshBranches: refreshGitBranches } = useGit()

  const navigate = useNavigate()
  const toggleTerminal = useUIStore((s) => s.toggleTerminal)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette)
  const { toggleDiff, toggleSessionTree } = useDiffRouteNavigation()

  function startDraftSessionRoute() {
    startDraftSession(projectPath)
    void navigate({ to: '/' })
  }

  useEffect(() => {
    void loadChatSessions()
    void loadSessionTrees()
  }, [loadChatSessions, loadSessionTrees])

  useEffect(() => {
    void refreshGitStatus(projectPath)
    void refreshGitBranches(projectPath)
  }, [projectPath, refreshGitStatus, refreshGitBranches])

  // Subscribe to LLM-generated title updates from main process
  useEffect(() => {
    return api.onSessionTitleUpdated(({ sessionId, title }) => {
      updateSessionTitle(sessionId, title)
    })
  }, [updateSessionTitle])

  useGitRefresh({
    projectPath,
    activeSessionId,
    refreshGitStatus,
    refreshGitBranches,
    refreshSession,
  })

  useEffect(() => {
    void refreshSessionTree(activeSessionId ? SessionId(String(activeSessionId)) : null)
  }, [activeSessionId, refreshSessionTree])

  useSessionStatusMonitor()

  useHotkeys(
    [
      { hotkey: 'Mod+J', callback: toggleTerminal },
      { hotkey: 'Mod+N', callback: startDraftSessionRoute },
      { hotkey: 'Mod+B', callback: toggleSidebar },
      { hotkey: 'Mod+D', callback: toggleDiff },
      { hotkey: 'Mod+K', callback: toggleCommandPalette },
      { hotkey: 'Mod+Shift+Y', callback: toggleSessionTree },
    ],
    { preventDefault: true },
  )
}
