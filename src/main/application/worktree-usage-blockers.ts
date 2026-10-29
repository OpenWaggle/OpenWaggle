import type { WorktreeRemovalBlocker, WorktreeSessionUsage } from '@shared/types/worktree-usage'
import type { WorkspaceOccupant } from '../ports/session-workspace-resource-repository'

/**
 * A Workspace that is not `ready` cannot be admitted for removal. `missing` and `failed` last
 * until someone repairs the Workspace, so they say that rather than "try again".
 */
export function workspaceBlocker(
  occupants: readonly (Pick<WorkspaceOccupant, 'workspace'> & {
    readonly canonicalWorkingPath: string | null
  })[],
  worktreePath: string,
): WorktreeRemovalBlocker | null {
  const states = new Set(
    occupants.flatMap((occupant) =>
      occupant.workspace?.kind === 'managed-worktree' &&
      occupant.canonicalWorkingPath === worktreePath &&
      occupant.workspace.lifecycleState !== 'ready'
        ? [occupant.workspace.lifecycleState]
        : [],
    ),
  )
  if (states.size === 0) return null
  const lasting = [...states].find((state) => state === 'missing' || state === 'failed')
  return {
    kind: 'workspace',
    message: lasting
      ? `Its Workspace is ${lasting}. Repair it from its Session, or hand the Session to another Workspace, first.`
      : 'Its Workspace is being created, changed or removed. Try again in a moment.',
  }
}

export function sessionBlocker(
  sessions: readonly WorktreeSessionUsage[],
): WorktreeRemovalBlocker | null {
  const using = sessions.filter((session) => !session.archived || session.running)
  const [first] = using
  if (!first) return null
  if (using.length > 1) {
    return {
      kind: 'session',
      message: `${String(using.length)} Sessions work in it. Archive them, and stop any Run they still have, first.`,
    }
  }
  return {
    kind: 'session',
    // An archived Session only blocks while its Run goes on, so archiving is no remedy there.
    message: first.archived
      ? `The archived Session “${first.title}” still has a Run in it. Stop that Run first.`
      : `The Session “${first.title}” works in it. Archive that Session first.`,
  }
}
