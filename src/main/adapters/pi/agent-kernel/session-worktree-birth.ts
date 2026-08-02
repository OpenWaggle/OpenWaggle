import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { runGit } from '../../../ipc/git/shared'
import { createGitWorktree } from '../../../ipc/git/worktree-service'
import { createLogger } from '../../../logger'
import { setSessionWorktree } from '../../../store/session-details'
import { resolveSessionProjectPath } from './session-manager'

const logger = createLogger('session-worktree-birth')
const SHORT_ID_LENGTH = 8

/**
 * Birth path for a Session worktree (ADR 0010). For a worktree-mode session
 * without a worktree yet, create one off the current ref and persist it, then
 * return its path. Local-mode sessions and failures fall back to the opened
 * checkout so the run always proceeds.
 */
export async function ensureSessionWorktreeProjectPath(session: SessionDetail): Promise<string> {
  const primaryPath = resolveSessionProjectPath(session)

  if (session.environmentMode !== 'worktree') return primaryPath
  const existing = session.worktreePath?.trim()
  if (existing && existsSync(existing)) return existing

  try {
    const baseRef = await resolveBaseRef(primaryPath)
    const sessionId = String(session.id)
    const worktreePath = worktreePathFor(primaryPath, sessionId)
    const branch = `ow/session-${sessionId.slice(0, SHORT_ID_LENGTH)}`

    const result = await createGitWorktree(primaryPath, { path: worktreePath, branch, baseRef })
    if (!result.ok) {
      logger.warn('Falling back to checkout; worktree creation failed', {
        code: result.code,
        message: result.message,
      })
      return primaryPath
    }
    await setSessionWorktree(SessionId(sessionId), 'worktree', worktreePath)
    return worktreePath
  } catch (error) {
    logger.warn('Falling back to checkout; worktree birth error', { error: String(error) })
    return primaryPath
  }
}

async function resolveBaseRef(projectPath: string) {
  const branch = await runGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (branch.code === 0 && branch.stdout.trim()) return branch.stdout.trim()
  return 'HEAD'
}

function worktreePathFor(primaryPath: string, sessionId: string) {
  const repoName = path.basename(primaryPath.replace(/\/+$/, '')) || 'repo'
  return path.join(homedir(), '.openwaggle', 'worktrees', repoName, sessionId)
}
