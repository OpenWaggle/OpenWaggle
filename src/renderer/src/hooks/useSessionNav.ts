import type { SessionId } from '@shared/types/brand'
import { useSessionStatusStore } from '@/stores/session-status-store'

interface SessionNavItem {
  readonly id: SessionId
  readonly projectPath: string | null
}

interface SessionNavDeps {
  readonly sessions: readonly SessionNavItem[]
  readonly projectPath: string | null
  readonly setActiveView: (view: 'chat' | 'skills') => void
  readonly setProjectPath: (path: string | null) => Promise<void>
  readonly selectFolder: () => Promise<string | null>
  readonly startDraftSession: () => void
  readonly setActiveSession: (id: SessionId | null) => void
  readonly refreshGitStatus: (projectPath: string | null) => Promise<void>
  readonly refreshGitBranches: (projectPath: string | null) => Promise<void>
}

interface SessionNavHandlers {
  readonly handleSelectSession: (id: SessionId) => Promise<void>
  readonly handleNewSession: () => void
  readonly handleOpenProject: () => Promise<void>
  readonly handleSelectProjectPath: (path: string) => Promise<void>
}

/** Pure factory — testable without React. */
export function createSessionNavHandlers(deps: SessionNavDeps): SessionNavHandlers {
  const {
    sessions,
    projectPath,
    setActiveView,
    setProjectPath,
    selectFolder,
    startDraftSession,
    setActiveSession,
    refreshGitStatus,
    refreshGitBranches,
  } = deps

  function refreshGit(path: string | null): void {
    void Promise.all([refreshGitStatus(path), refreshGitBranches(path)])
  }

  async function handleSelectSession(id: SessionId): Promise<void> {
    setActiveView('chat')
    const session = sessions.find((c) => c.id === id)
    const nextProjectPath = session?.projectPath ?? projectPath
    setActiveSession(id)
    useSessionStatusStore.getState().markVisited(id)
    if (session && session.projectPath !== projectPath) {
      await setProjectPath(session.projectPath)
    }
    refreshGit(nextProjectPath)
  }

  function handleNewSession(): void {
    setActiveView('chat')
    startDraftSession()
  }

  async function handleOpenProject(): Promise<void> {
    setActiveView('chat')
    const path = await selectFolder()
    if (!path) return
    await setProjectPath(path)
    startDraftSession()
    refreshGit(path)
  }

  async function handleSelectProjectPath(path: string): Promise<void> {
    setActiveView('chat')
    await setProjectPath(path)
    startDraftSession()
    refreshGit(path)
  }

  return {
    handleSelectSession,
    handleNewSession,
    handleOpenProject,
    handleSelectProjectPath,
  }
}

/** Hook wrapper — calls the factory with current deps. */
export function useSessionNav(deps: SessionNavDeps): SessionNavHandlers {
  return createSessionNavHandlers(deps)
}
