import { legacySessionWorktreeBranch, sessionWorktreeBranch } from '@shared/utils/worktree'
import { runGit } from '../../adapters/git/run-git'

async function branchExists(repositoryPath: string, branch: string) {
  const result = await runGit(repositoryPath, [
    'show-ref',
    '--verify',
    '--quiet',
    `refs/heads/${branch}`,
  ])
  return result.code === 0
}

/**
 * The branch a session's worktree should use, for every path that creates one.
 *
 * Session worktree branches are named from the full session id. A session born before that
 * convention owns a branch named from the first 8 characters, and that branch may carry commits the
 * agent already made - so when the current name does not exist yet and the legacy one does, the
 * legacy branch is reused rather than a divergent one being created at the base ref.
 *
 * Shared deliberately. This lived inside worktree birth, while the recreation the UI offers derived
 * the name in the renderer and never consulted the legacy one: recreating a legacy session's tree
 * created `ow/session-<full-id>` fresh and left the agent's commits on `ow/session-<8-char>`, which
 * is exactly the loss the legacy helper exists to prevent. One resolver, used by both.
 */
export async function resolveSessionWorktreeBranch(
  repositoryPath: string,
  sessionId: string,
): Promise<string> {
  const branch = sessionWorktreeBranch(sessionId)
  if (await branchExists(repositoryPath, branch)) return branch

  const legacy = legacySessionWorktreeBranch(sessionId)
  return (await branchExists(repositoryPath, legacy)) ? legacy : branch
}
