import type { RepositoryPath } from '@shared/types/brand'
import { RepositoryPath as makeRepositoryPath } from '@shared/types/brand'
import { resolveSessionWorkingDir } from '@shared/utils/worktree'
import type { useNavigate } from '@tanstack/react-router'
import { useBranchSummaryStore, useChatStore } from '@/features/chat/state'
import { useGitStore } from '@/features/git/state'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useSidebarViewStore } from '../state/sidebar-view-store'

type Navigate = ReturnType<typeof useNavigate>

export interface ProjectDraftNavigationDeps {
  readonly clearTransientDraftContext: () => void
  readonly startDraftSession: (projectPath: string | null) => void
  readonly expandProject: (path: string) => void
  readonly navigate: Navigate
  readonly setProjectPath: (path: string) => Promise<void>
  readonly refreshGit: (path: RepositoryPath | null) => void
}

/** Select a project and start a new draft Session in it, as choosing it in the sidebar does. */
export async function openProjectInDraft(deps: ProjectDraftNavigationDeps, path: string) {
  deps.clearTransientDraftContext()
  deps.startDraftSession(path)
  deps.expandProject(path)
  void deps.navigate({ to: '/' })
  await deps.setProjectPath(path)
  deps.refreshGit(makeRepositoryPath(path))
}

/** The same navigation for callers outside the sidebar, bound to the app stores. */
export function storeProjectDraftNavigation(navigate: Navigate): ProjectDraftNavigationDeps {
  return {
    clearTransientDraftContext() {
      useBranchSummaryStore.getState().clearPrompt()
      const sessions = useSessionStore.getState()
      if (sessions.draftBranch) sessions.clearDraftBranchForSession(sessions.draftBranch.sessionId)
    },
    startDraftSession: (projectPath) => useChatStore.getState().startDraftSession(projectPath),
    expandProject: (path) => useSidebarViewStore.getState().setProjectExpanded(path, true),
    navigate,
    setProjectPath: (path) => usePreferencesStore.getState().setProjectPath(path),
    refreshGit(path) {
      const git = useGitStore.getState()
      void Promise.all([
        git.refreshStatus(resolveSessionWorkingDir(null, path)),
        git.refreshBranches(path),
      ])
    },
  }
}
