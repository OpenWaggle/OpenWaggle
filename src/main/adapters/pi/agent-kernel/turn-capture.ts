import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { runGit } from '../../../ipc/git/shared'
import { createLogger } from '../../../logger'
import {
  getLatestSnapshotRef,
  listTurnCheckpoints,
  pruneTurnCheckpoints,
  recordTurnCheckpoint,
} from '../../../store/turn-checkpoints'

const logger = createLogger('turn-capture')
const MAX_CHECKPOINTS_PER_SESSION = 100

/**
 * Best-effort per-turn checkpoint capture (WS7). Snapshots the worktree with a
 * read-only `git stash create` (never mutates the index/working tree) and stores
 * the incremental diff since the previous turn's snapshot as the Turn diff.
 * Never throws: capture failures must not affect the agent run.
 */
export async function captureTurnCheckpoint(input: {
  readonly session: SessionDetail
  readonly projectPath: string
  readonly runId: string
}): Promise<void> {
  try {
    const sessionId = SessionId(String(input.session.id))
    const snapshotRef = await createWorktreeSnapshot(input.projectPath)
    const previousRef = await getLatestSnapshotRef(sessionId)
    const diff = await computeIncrementalDiff(input.projectPath, previousRef, snapshotRef)
    if (!diff.trim()) return

    const existing = await listTurnCheckpoints(sessionId)
    await recordTurnCheckpoint({
      sessionId,
      turnId: input.runId,
      turnIndex: existing.length,
      diff,
      snapshotRef,
    })
    await pruneTurnCheckpoints(sessionId, MAX_CHECKPOINTS_PER_SESSION)
  } catch (error) {
    logger.warn('Failed to capture turn checkpoint', { error: String(error) })
  }
}

/**
 * Snapshot the current worktree without touching the index/working tree.
 * Returns the snapshot commit SHA, or null when there is nothing to snapshot
 * (worktree matches HEAD) or the repo has no commits.
 */
async function createWorktreeSnapshot(projectPath: string): Promise<string | null> {
  const head = await runGit(projectPath, ['rev-parse', '--verify', 'HEAD'])
  if (head.code !== 0) return null
  const stash = await runGit(projectPath, ['stash', 'create', 'openwaggle-turn-checkpoint'])
  if (stash.code !== 0) return null
  return stash.stdout.trim() || null
}

/**
 * Diff between the previous turn snapshot and the current one. Falls back to
 * HEAD as the base when either side is missing so the first turn captures its
 * changes relative to the last commit.
 */
async function computeIncrementalDiff(
  projectPath: string,
  previousRef: string | null,
  currentRef: string | null,
): Promise<string> {
  const from = previousRef ?? 'HEAD'
  const to = currentRef ?? 'HEAD'
  if (from === to) return ''
  const result = await runGit(projectPath, [
    'diff',
    '--patch',
    '--find-renames',
    '--no-ext-diff',
    from,
    to,
  ])
  return result.code === 0 ? result.stdout : ''
}
