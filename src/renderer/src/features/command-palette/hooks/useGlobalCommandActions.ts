import { useNavigate } from '@tanstack/react-router'
import { useChat } from '@/features/chat/hooks'
import { useProject, useSessions } from '@/features/sessions/hooks'
import { usePreferencesStore } from '@/features/settings/state'
import { useTerminalCommands } from '@/features/terminal'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'
import type { CoreCommandActions } from '../lib/global-command-core-items'

export function useGlobalCommandActions() {
  const navigate = useNavigate()
  const { projectPath, selectFolder, setProjectPath } = useProject()
  const { refreshSessionWorkspace } = useSessions()
  const { sessions, activeSessionId, setActiveSession, startDraftSession, refreshSession } =
    useChat()
  const close = useUIStore((state) => state.closeCommandSurface)
  const openCommandSurface = useUIStore((state) => state.openCommandSurface)
  const requestChatCommand = useUIStore((state) => state.requestChatCommand)
  const setLastRightSidebarPanel = useUIStore((state) => state.setLastRightSidebarPanel)
  const openFeedbackModal = useUIStore((state) => state.openFeedbackModal)
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const toggleTerminal = useUIStore((state) => state.toggleTerminal)
  const { newTerminal, splitTerminal } = useTerminalCommands()
  const showToast = useUIStore((state) => state.showToast)
  const settings = usePreferencesStore((state) => state.settings)
  const sessionId = activeSessionId ? String(activeSessionId) : null

  function finish(action: () => void) {
    close()
    action()
  }

  function routeToSession(id: string) {
    const session = sessions.find((candidate) => String(candidate.id) === id)
    if (session) setActiveSession(session.id)
    void navigate({ to: '/sessions/$sessionId', params: { sessionId: id } })
  }

  function newSession(path: string | null) {
    startDraftSession(path)
    void navigate({ to: '/' })
  }

  async function selectProject(mode: 'new' | 'open') {
    close()
    const selected = await selectFolder()
    if (!selected) return
    await setProjectPath(selected)
    const recent = sessions
      .filter((session) => session.projectPath === selected)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]
    if (mode === 'open' && recent) {
      routeToSession(String(recent.id))
      return
    }
    newSession(selected)
  }

  function openBuiltInPanel(panel: 'diff' | 'session-tree') {
    setLastRightSidebarPanel(panel)
    if (sessionId) {
      void navigate({
        to: '/sessions/$sessionId',
        params: { sessionId },
        search: (previous) => ({
          ...previous,
          diff: undefined,
          panel,
          filePath: undefined,
          fileLine: undefined,
        }),
      })
      return
    }
    void navigate({ to: '/', search: { panel, diff: undefined } })
  }

  function requestSessionCommand(command: 'clone-session' | 'fork-session') {
    if (!sessionId) {
      showToast('Open a session first.', 'error')
      return
    }
    requestChatCommand(command)
    routeToSession(sessionId)
  }

  async function compactSession() {
    if (!activeSessionId) {
      showToast('Open a session first.', 'error')
      return
    }
    try {
      await api.compactSession(activeSessionId, settings.selectedModel)
      await Promise.all([refreshSession(activeSessionId), refreshSessionWorkspace(activeSessionId)])
      showToast('Session compacted.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  function navigateTo(target: Parameters<CoreCommandActions['navigateTo']>[0]) {
    if (target === 'settings') {
      void navigate({ to: '/settings' })
      return
    }
    if (target === 'skills') {
      void navigate({ to: '/skills' })
      return
    }
    void navigate({
      to: '/settings/$tab',
      params: { tab: target === 'waggle' ? 'waggle' : 'extensions' },
    })
  }

  const actions: CoreCommandActions = {
    compactSession,
    finish,
    navigateTo,
    newSession,
    openBuiltInPanel,
    openCommandSurface,
    openFeedbackModal,
    requestSessionCommand,
    routeToSession,
    selectProject,
    setProjectPath,
    toggleSidebar,
    toggleTerminal,
    newTerminal,
    splitTerminal,
  }
  return { actions, close, projectPath, sessionId, sessions, settings }
}
