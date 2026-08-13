import type { SessionSummary } from '@shared/types/session'
import { resolveSessionWorkingDir } from '@shared/utils/worktree'
import { useEffect } from 'react'
import { selectWorkingTreeStatus, useGitStore } from '@/features/git'
import { buildSessionGitIndicator } from '../lib/session-git-indicator'

/**
 * Load git status for every listed session's working tree, so each row can show its
 * own state rather than the active session's.
 *
 * Fetching per session is affordable because the main process caches status behind a
 * short TTL and de-duplicates by path, so sessions sharing a working tree — every
 * local-mode session in one project — collapse to a single git invocation.
 */
export function useSessionGitIndicators(sessions: readonly SessionSummary[]): void {
  const refreshStatus = useGitStore((s) => s.refreshStatus)

  // Join the distinct working paths so the effect re-runs when the set changes, not
  // when the array identity does: session lists are rebuilt on every poll.
  const workingPathKey = distinctWorkingPaths(sessions).join('\u0000')

  useEffect(() => {
    for (const workingPath of workingPathKey.split('\u0000')) {
      if (workingPath.length > 0) void refreshStatus(workingPath)
    }
  }, [workingPathKey, refreshStatus])
}

/** The working tree a session row describes, or null when it has no project. */
export function sessionWorkingPath(session: SessionSummary): string | null {
  return resolveSessionWorkingDir(
    { environmentMode: session.environmentMode, worktreePath: session.worktreePath ?? null },
    session.projectPath,
  )
}

/** One session's working-tree indicator, empty until its status is known. */
export function useSessionGitIndicator(session: SessionSummary) {
  const workingPath = sessionWorkingPath(session)
  const status = useGitStore((s) => selectWorkingTreeStatus(s, workingPath).status)
  return buildSessionGitIndicator(status)
}

function distinctWorkingPaths(sessions: readonly SessionSummary[]): string[] {
  const paths = new Set<string>()
  for (const session of sessions) {
    const workingPath = sessionWorkingPath(session)
    if (workingPath !== null) paths.add(workingPath)
  }
  return [...paths].sort()
}
