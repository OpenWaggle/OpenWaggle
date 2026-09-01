import type { WorktreeLaunchSnapshot } from '@shared/types/background-run'
import type { SessionId } from '@shared/types/brand'

interface WorktreeLaunchSourceSnapshot {
  readonly sessionId: SessionId
  readonly worktreeLaunch?: WorktreeLaunchSnapshot
}

export function launchesFromSnapshots(
  snapshots: readonly (WorktreeLaunchSourceSnapshot | null)[],
): Map<SessionId, WorktreeLaunchSnapshot> {
  const launches = new Map<SessionId, WorktreeLaunchSnapshot>()
  for (const snapshot of snapshots) {
    if (snapshot?.worktreeLaunch) launches.set(snapshot.sessionId, snapshot.worktreeLaunch)
  }
  return launches
}

export function mergeLatestLaunches(
  ...sources: readonly ReadonlyMap<SessionId, WorktreeLaunchSnapshot>[]
) {
  const launches = new Map<SessionId, WorktreeLaunchSnapshot>()
  for (const source of sources) {
    for (const [sessionId, launch] of source) {
      const existing = launches.get(sessionId)
      if (!existing || launch.updatedAt >= existing.updatedAt) launches.set(sessionId, launch)
    }
  }
  return launches
}

const INTERRUPTED_FIRST_SEND_MESSAGE =
  'The worktree launch was interrupted before the task was delivered. Retry, work locally, or cancel to restore the draft.'

export function interruptedFirstSendLaunch(
  launch: WorktreeLaunchSnapshot | undefined,
): WorktreeLaunchSnapshot {
  if (launch?.status === 'failed') return launch
  const now = Date.now()
  return {
    ...launch,
    status: 'failed',
    stage: launch?.stage ?? 'preparing-workspace',
    startedAt: launch?.startedAt ?? now,
    updatedAt: now,
    details: launch
      ? [...launch.details, INTERRUPTED_FIRST_SEND_MESSAGE]
      : [INTERRUPTED_FIRST_SEND_MESSAGE],
    errorMessage: INTERRUPTED_FIRST_SEND_MESSAGE,
  }
}
