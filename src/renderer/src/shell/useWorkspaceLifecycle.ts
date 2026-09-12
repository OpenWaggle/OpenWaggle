import { SessionId } from '@shared/types/brand'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useChat } from '@/features/chat/hooks'
import { focusPendingRequest } from '@/features/chat/lib'
import { useDiffRouteNavigation } from '@/features/diff-panel/hooks'
import { useGit, useGitRefresh } from '@/features/git/hooks'
import { useProjectActions, useRunProjectAction } from '@/features/project-actions'
import { useProject, useSessionStatusMonitor, useSessions } from '@/features/sessions/hooks'
import { useSyntaxThemeCatalogStore } from '@/features/settings'
import { usePreferencesStore } from '@/features/settings/state'
import { usePinnedSessionShortcuts, useSidebarSearchShortcut } from '@/features/sidebar/hooks'
import { terminalOwnerContext, useTerminalCommands } from '@/features/terminal'
import { useUIStore } from '@/shell/ui-store'
import { useSessionHostRefresh } from './useSessionHostRefresh'
import {
  type BuiltInShortcutHandlers,
  useUnifiedShortcutCapture,
} from './useUnifiedShortcutCapture'
import {
  closeWorkspaceRightPanel,
  focusWorkspacePreviewAddress,
  hasActiveWorkspaceRightPanel,
  refreshWorkspacePreview,
  toggleWorkspacePanelMaximized,
  toggleWorkspacePreview,
  toggleWorkspaceRightPanel,
  zoomWorkspacePreview,
} from './workspace-panel-actions'

type PreviewShortcutHandlers = Pick<
  BuiltInShortcutHandlers,
  | 'preview.toggle'
  | 'preview.refresh'
  | 'preview.focusUrl'
  | 'preview.zoomIn'
  | 'preview.zoomOut'
  | 'preview.resetZoom'
>

function previewShortcutHandlers(
  ownerKey: string,
  showToast: (message: string, type: 'error') => void,
): PreviewShortcutHandlers {
  const run = (action: () => Promise<boolean>, fallback: string) => {
    void action().catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : fallback, 'error')
    })
  }
  return {
    'preview.toggle': () => void toggleWorkspacePreview(ownerKey),
    'preview.refresh': () =>
      run(() => refreshWorkspacePreview(ownerKey), 'Preview could not reload.'),
    'preview.focusUrl': () => {
      if (!focusWorkspacePreviewAddress(ownerKey)) {
        showToast('Open a browser preview first.', 'error')
      }
    },
    'preview.zoomIn': () =>
      run(() => zoomWorkspacePreview(ownerKey, 'in'), 'Preview could not zoom in.'),
    'preview.zoomOut': () =>
      run(() => zoomWorkspacePreview(ownerKey, 'out'), 'Preview could not zoom out.'),
    'preview.resetZoom': () =>
      run(() => zoomWorkspacePreview(ownerKey, 'reset'), 'Preview zoom could not reset.'),
  }
}

export function useWorkspaceLifecycle(): void {
  const { projectPath } = useProject()
  const {
    activeSessionId,
    activeSession,
    startDraftSession,
    loadSessions: loadChatSessions,
    refreshSession,
    updateSessionTitle,
  } = useChat()
  const {
    loadSessions: loadSessionTrees,
    refreshCatalogSessions,
    refreshSessionTree,
  } = useSessions()
  const {
    refreshStatus: refreshGitStatus,
    refreshBranches: refreshGitBranches,
    workingPath,
    repositoryPath,
  } = useGit()

  const navigate = useNavigate()
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const openCommandSurface = useUIStore((s) => s.openCommandSurface)
  const closeCommandSurface = useUIStore((s) => s.closeCommandSurface)
  const commandSurface = useUIStore((s) => s.commandSurface)
  const showToast = useUIStore((s) => s.showToast)
  const shortcutRules = usePreferencesStore((s) => s.settings.shortcutRules)
  const loadSyntaxResources = useSyntaxThemeCatalogStore((state) => state.load)
  const { toggleDiff, toggleSessionTree } = useDiffRouteNavigation()
  function startDraftSessionRoute() {
    closeCommandSurface()
    startDraftSession(projectPath)
    void navigate({ to: '/' })
  }

  useSessionHostRefresh({
    activeSessionId,
    loadChatSessions,
    loadSessionTrees,
    refreshCatalogSessions,
    refreshSession,
    refreshSessionTree,
    updateSessionTitle,
  })

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

  useEffect(() => {
    void loadSyntaxResources(workingPath)
  }, [loadSyntaxResources, workingPath])
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

  const terminalCommands = useTerminalCommands()
  const terminalOwner = terminalOwnerContext(activeSession ?? null, projectPath ?? null)
  const projectActions = useProjectActions(projectPath).data ?? []
  const runProjectAction = useRunProjectAction(projectPath)
  useUnifiedShortcutCapture({
    actions: projectActions,
    builtInRules: shortcutRules,
    handlers: {
      'commandPalette.toggle': () =>
        commandSurface === 'commands' ? closeCommandSurface() : openCommandSurface('commands'),
      'filePicker.toggle': () =>
        commandSurface === 'files' ? closeCommandSurface() : openCommandSurface('files'),
      'chat.new': startDraftSessionRoute,
      'terminal.toggle': terminalCommands.toggleTerminal,
      'terminal.new': terminalCommands.newTerminal,
      'terminal.split': terminalCommands.splitTerminal,
      'terminal.splitVertical': terminalCommands.splitTerminalVertical,
      'terminal.close': () => void terminalCommands.closeActiveTerminal(),
      'rightPanel.toggle': () => {
        if (!toggleWorkspaceRightPanel(terminalOwner.ownerKey)) terminalCommands.newSideTerminal()
      },
      'rightPanel.toggleMaximized': () => {
        if (!toggleWorkspacePanelMaximized(terminalOwner.ownerKey)) {
          showToast('Open the workspace right panel first.', 'error')
        }
      },
      'rightPanel.close': () => closeWorkspaceRightPanel(terminalOwner.ownerKey),
      'sidebar.toggle': toggleSidebar,
      'diff.toggle': toggleDiff,
      ...previewShortcutHandlers(terminalOwner.ownerKey, showToast),
      'sessionTree.toggle': toggleSessionTree,
      'request.focus': focusPendingRequest,
    },
    onRunProjectAction: (action) => void runProjectAction(action),
    shouldHandleBuiltIn: (command) =>
      command !== 'rightPanel.close' || hasActiveWorkspaceRightPanel(terminalOwner.ownerKey),
    terminalOpen: terminalCommands.panelOpen,
  })
}
