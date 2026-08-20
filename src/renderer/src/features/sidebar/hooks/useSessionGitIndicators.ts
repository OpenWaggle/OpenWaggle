import type { WorkingPath } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { resolveSessionWorkingDir } from '@shared/utils/worktree'
import { useEffect, useMemo } from 'react'
import { selectWorkingTreeStatus, useGitStore } from '@/features/git'
import { api } from '@/shared/lib/ipc'
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

  // Distinct branded working paths, all produced by resolveSessionWorkingDir, memoised
  // by the path set so the effects re-run on a set change rather than on every list
  // rebuild. The map also recovers the branded value for the change event's plain path
  // without re-branding it, so the producer stays the only source of a WorkingPath.
  const brandByPath = useMemo(() => {
    const map = new Map<string, WorkingPath>()
    for (const session of sessions) {
      const workingPath = sessionWorkingPath(session)
      if (workingPath !== null) map.set(String(workingPath), workingPath)
    }
    return map
  }, [sessions])

  useEffect(() => {
    for (const branded of brandByPath.values()) void refreshStatus(branded)
  }, [brandByPath, refreshStatus])

  /*
   * Keep BACKGROUND sessions current too. The active session is refreshed on its own
   * turn boundary, but a session the user is not looking at would otherwise keep its
   * indicator from first load until the list happened to rebuild — which defeats the
   * point of showing per-session state. Any tracked path that the main process reports
   * as changed is re-read here.
   */
  useEffect(() => {
    return api.onGitWorkingTreeChanged(({ workingPath }) => {
      const branded = brandByPath.get(workingPath)
      if (branded !== undefined) void refreshStatus(branded)
    })
  }, [brandByPath, refreshStatus])
}

/** The working tree a session row describes, or null when it has no project. */
export function sessionWorkingPath(session: SessionSummary): WorkingPath | null {
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

/**
 * The git branch this session's working tree is on, or null until status is known.
 *
 * Read separately from the ahead/behind indicator because a row shows the branch as an
 * icon whose accessible name carries the value, while divergence renders as text.
 */
export function useSessionGitBranch(session: SessionSummary): string | null {
  const workingPath = sessionWorkingPath(session)
  const branch = useGitStore((s) => selectWorkingTreeStatus(s, workingPath).status?.branch)
  const trimmed = branch?.trim()
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : null
}
