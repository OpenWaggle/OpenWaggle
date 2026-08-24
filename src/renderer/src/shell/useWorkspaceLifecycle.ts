import { SessionId } from '@shared/types/brand'
import { type UseHotkeyDefinition, useHotkeys } from '@tanstack/react-hotkeys'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useChat } from '@/features/chat/hooks'
import { focusPendingRequest } from '@/features/chat/lib'
import { useDiffRouteNavigation } from '@/features/diff-panel/hooks'
import { useGit, useGitRefresh } from '@/features/git/hooks'
import { useProject, useSessionStatusMonitor, useSessions } from '@/features/sessions/hooks'
import { usePreferencesStore } from '@/features/settings/state'
import { usePinnedSessionShortcuts, useSidebarSearchShortcut } from '@/features/sidebar/hooks'
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
  const {
    refreshStatus: refreshGitStatus,
    refreshBranches: refreshGitBranches,
    workingPath,
    repositoryPath,
  } = useGit()

  const navigate = useNavigate()
  const toggleTerminal = useUIStore((s) => s.toggleTerminal)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const openCommandSurface = useUIStore((s) => s.openCommandSurface)
  const closeCommandSurface = useUIStore((s) => s.closeCommandSurface)
  const commandSurface = useUIStore((s) => s.commandSurface)
  const shortcutBindings = usePreferencesStore((s) => s.settings.shortcutBindings)
  const { toggleDiff, toggleSessionTree } = useDiffRouteNavigation()

  function startDraftSessionRoute() {
    closeCommandSurface()
    startDraftSession(projectPath)
    void navigate({ to: '/' })
  }

  useEffect(() => {
    void loadChatSessions()
    void loadSessionTrees()
  }, [loadChatSessions, loadSessionTrees])

  useEffect(() => {
    // Status follows the active session's working tree; the branch list is
    // repository-level (ADR 0018).
    void refreshGitStatus(workingPath)
    void refreshGitBranches(repositoryPath)
  }, [workingPath, repositoryPath, refreshGitStatus, refreshGitBranches])

  // Subscribe to LLM-generated title updates from main process
  useEffect(() => {
    return api.onSessionTitleUpdated(({ sessionId, title }) => {
      updateSessionTitle(sessionId, title)
    })
  }, [updateSessionTitle])

  useGitRefresh({
    workingPath,
    repositoryPath,
    activeSessionId,
    refreshGitStatus,
    refreshGitBranches,
    refreshSession,
  })

  useEffect(() => {
    void refreshSessionTree(activeSessionId ? SessionId(String(activeSessionId)) : null)
  }, [activeSessionId, refreshSessionTree])

  useSessionStatusMonitor()
  usePinnedSessionShortcuts()
  useSidebarSearchShortcut()

  const hotkeys: UseHotkeyDefinition[] = [
    {
      binding: shortcutBindings['commandPalette.toggle'],
      callback: () =>
        commandSurface === 'commands' ? closeCommandSurface() : openCommandSurface('commands'),
    },
    {
      binding: shortcutBindings['filePicker.toggle'],
      callback: () =>
        commandSurface === 'files' ? closeCommandSurface() : openCommandSurface('files'),
    },
    {
      binding: shortcutBindings['chat.new'],
      callback: startDraftSessionRoute,
    },
    {
      binding: shortcutBindings['terminal.toggle'],
      callback: toggleTerminal,
    },
    {
      binding: shortcutBindings['sidebar.toggle'],
      callback: toggleSidebar,
    },
    {
      binding: shortcutBindings['diff.toggle'],
      callback: toggleDiff,
    },
    {
      binding: shortcutBindings['sessionTree.toggle'],
      callback: toggleSessionTree,
    },
    {
      binding: shortcutBindings['request.focus'],
      callback: focusPendingRequest,
    },
  ].flatMap((item) => (item.binding ? [{ hotkey: item.binding, callback: item.callback }] : []))

  useHotkeys(hotkeys, { preventDefault: true })
}
