import type { RepositoryPath, SessionId, WorkingPath } from '@shared/types/brand'
import { RepositoryPath as makeRepositoryPath } from '@shared/types/brand'
import { resolveSessionWorkingDir } from '@shared/utils/worktree'
import { useSessionStatusStore } from '@/features/sessions/state/session-status-store'

interface SessionNavItem {
  readonly id: SessionId
  readonly projectPath: string | null
  readonly environmentMode?: 'local' | 'worktree'
  readonly worktreePath?: string | null
}

interface SessionNavDeps {
  readonly sessions: readonly SessionNavItem[]
  readonly projectPath: string | null
  readonly setActiveView: (view: 'chat' | 'skills') => void
  readonly setProjectPath: (path: string | null) => Promise<void>
  readonly selectFolder: () => Promise<string | null>
  readonly startDraftSession: (projectPath?: string | null) => void
  readonly setActiveSession: (id: SessionId | null) => void
  readonly refreshGitStatus: (workingPath: WorkingPath | null) => Promise<void>
  readonly refreshGitBranches: (repositoryPath: RepositoryPath | null) => Promise<void>
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

  function refreshGit(
    session: { environmentMode?: 'local' | 'worktree'; worktreePath?: string | null } | null,
    path: string | null,
  ) {
    // Status targets the selected session's working tree via the sole WorkingPath
    // producer; the branch list is repository-level.
    void Promise.all([
      refreshGitStatus(resolveSessionWorkingDir(session, path)),
      refreshGitBranches(path === null ? null : makeRepositoryPath(path)),
    ])
  }

  async function handleSelectSession(id: SessionId) {
    setActiveView('chat')
    const session = sessions.find((c) => c.id === id)
    const nextProjectPath = session?.projectPath ?? projectPath
    setActiveSession(id)
    useSessionStatusStore.getState().markVisited(id)
    if (session && session.projectPath !== projectPath) {
      await setProjectPath(session.projectPath)
    }
    refreshGit(session ?? null, nextProjectPath)
  }

  function handleNewSession() {
    setActiveView('chat')
    startDraftSession(projectPath)
  }

  async function handleOpenProject() {
    setActiveView('chat')
    const path = await selectFolder()
    if (!path) return
    startDraftSession(path)
    await setProjectPath(path)
    refreshGit(null, path)
  }

  async function handleSelectProjectPath(path: string) {
    setActiveView('chat')
    startDraftSession(path)
    await setProjectPath(path)
    refreshGit(null, path)
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
