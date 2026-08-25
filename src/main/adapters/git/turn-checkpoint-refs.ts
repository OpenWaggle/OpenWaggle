import { turnCheckpointSessionNamespace } from '@shared/utils/turn-checkpoint-ref'
import { createLogger } from '../../logger'
import { runGit } from './run-git'

const logger = createLogger('turn-checkpoint-refs')

/**
 * Delete every Turn checkpoint anchor ref belonging to a session (best-effort).
 *
 * Snapshot commits hold a full tree of the working copy, including untracked files, and the
 * anchor refs keep them permanently reachable: verified that a ref under this namespace
 * survives worktree removal, branch deletion and `git gc --prune=now`. Deleting only the DB
 * rows when a session died therefore leaked those objects into the user's real repository
 * forever, with no way to reclaim the space.
 *
 * Deletes the whole per-session namespace rather than a list of turn ids, so refs whose rows
 * were already pruned (or never recorded) are collected too.
 */
export async function deleteSessionTurnCheckpointRefs(
  projectPath: string,
  sessionId: string,
): Promise<void> {
  const namespace = turnCheckpointSessionNamespace(sessionId)
  const listed = await runGit(projectPath, ['for-each-ref', '--format=%(refname)', namespace])
  if (listed.code !== 0) {
    logger.warn('Could not list turn checkpoint refs', { sessionId, stderr: listed.stderr })
    return
  }

  const refs = listed.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (refs.length === 0) return

  const failures = await Promise.all(
    refs.map(async (ref) => {
      const deleted = await runGit(projectPath, ['update-ref', '-d', ref])
      return deleted.code === 0 ? null : ref
    }),
  )
  const failed = failures.filter((ref) => ref !== null)
  if (failed.length > 0) {
    logger.warn('Could not delete some turn checkpoint refs', {
      sessionId,
      failed: failed.length,
      of: refs.length,
    })
  }
}
