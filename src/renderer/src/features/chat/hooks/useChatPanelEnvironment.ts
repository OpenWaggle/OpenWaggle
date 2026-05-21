import type { SessionBranchId } from '@shared/types/brand'
import { useNavigate } from '@tanstack/react-router'
import { useChat } from '@/features/chat/hooks/useChat'
import { useGit } from '@/features/git/hooks'
import { useProject, useSessionNav } from '@/features/sessions/hooks'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { useUIStore } from '@/shell/ui-store'

const logger = createRendererLogger('chat-panel')

function reportNavigationError(
  label: string,
  error: unknown,
  showToast: (message: string) => void,
) {
  const message = error instanceof Error ? error.message : String(error)
  logger.error(label, { error: message })
  showToast(message)
}

export function useChatPanelEnvironment() {
  const navigate = useNavigate()
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen)
  const setActiveView = useUIStore((s) => s.setActiveView)
  const showToast = useUIStore((s) => s.showToast)
  const model = usePreferencesStore((s) => s.settings.selectedModel)
  const thinkingLevel = usePreferencesStore((s) => s.settings.thinkingLevel)
  const recentProjects = usePreferencesStore((s) => s.settings.recentProjects)
  const project = useProject()
  const chat = useChat()
  const git = useGit()
  const activeWorkspace = useSessionStore((state) => state.activeWorkspace)
  const loadSessions = useSessionStore((state) => state.loadSessions)
  const refreshSessionWorkspace = useSessionStore((state) => state.refreshSessionWorkspace)
  const draftBranch = useSessionStore((state) => state.draftBranch)
  const setDraftBranch = useSessionStore((state) => state.setDraftBranch)
  const clearDraftBranchForSession = useSessionStore((state) => state.clearDraftBranchForSession)
  const sessionNav = useSessionNav({
    sessions: chat.sessions,
    projectPath: project.projectPath,
    setActiveView,
    setProjectPath: project.setProjectPath,
    selectFolder: project.selectFolder,
    startDraftSession: chat.startDraftSession,
    setActiveSession: chat.setActiveSession,
    refreshGitStatus: git.refreshStatus,
    refreshGitBranches: git.refreshBranches,
  })

  async function handleOpenProject() {
    try {
      await sessionNav.handleOpenProject()
      void navigate({ to: '/' })
    } catch (error) {
      reportNavigationError('Failed to open project', error, showToast)
    }
  }

  async function handleSelectProjectPath(path: string) {
    try {
      await sessionNav.handleSelectProjectPath(path)
      void navigate({ to: '/' })
    } catch (error) {
      reportNavigationError('Failed to select project', error, showToast)
    }
  }

  function handleDismissInterruptedRun(runId: string, branchId: SessionBranchId) {
    const sessionId = chat.activeSessionId
    if (!sessionId) return
    if (typeof api.dismissInterruptedSessionRun !== 'function') {
      showToast('Update OpenWaggle to dismiss interrupted run notices.')
      return
    }
    void api
      .dismissInterruptedSessionRun(sessionId, runId)
      .then(() =>
        Promise.all([
          loadSessions(),
          chat.refreshSession(sessionId),
          refreshSessionWorkspace(sessionId, { branchId }),
        ]),
      )
      .catch((error: unknown) => {
        showToast(error instanceof Error ? error.message : String(error))
      })
  }

  return {
    activeWorkspace,
    chat,
    clearDraftBranchForSession,
    commandPaletteOpen,
    draftBranch,
    handleDismissInterruptedRun,
    handleOpenProject,
    handleSelectProjectPath,
    loadSessions,
    model,
    navigate,
    openSettings() {
      void navigate({ to: '/settings' })
    },
    projectPath: project.projectPath,
    recentProjects,
    refreshSessionWorkspace,
    setDraftBranch,
    showToast,
    thinkingLevel,
  }
}
