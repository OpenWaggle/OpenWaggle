import { RepositoryPath, type WorkingPath } from '@shared/types/brand'
import { resolveSessionWorkingDir } from '@shared/utils/worktree'
import { useChatStore } from '@/features/chat/state'
import { usePreferencesStore } from '@/features/settings/state'

/**
 * The working tree the active session's git status and mutations target.
 *
 * Delegates to the shared `resolveSessionWorkingDir` rather than re-deriving the
 * rule. A second resolver is what caused the defect this fixes: the diff section
 * resolved the session's worktree while the git store refreshed the project path,
 * so the two halves of the UI reported on different trees.
 *
 * Repository-level data (branch list, worktree list, remotes) must use
 * `useRepositoryPath` instead: a linked worktree shares `refs/` with the primary
 * checkout, so that data is per-repository, not per session.
 */
export function useActiveWorkingPath(): WorkingPath | null {
  const projectPath = usePreferencesStore((s) => s.settings.projectPath)
  const environmentMode = useChatStore((s) => s.activeSession?.environmentMode)
  const worktreePath = useChatStore((s) => s.activeSession?.worktreePath ?? null)

  return resolveSessionWorkingDir({ environmentMode, worktreePath }, projectPath)
}

/** The repository a session belongs to. Keys branch lists, worktree lists and remotes. */
export function useRepositoryPath(): RepositoryPath | null {
  const projectPath = usePreferencesStore((s) => s.settings.projectPath)
  return projectPath === null ? null : RepositoryPath(projectPath)
}
