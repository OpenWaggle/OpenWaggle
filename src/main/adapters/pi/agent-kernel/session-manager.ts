import { existsSync } from 'node:fs'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import type { SessionDetail } from '@shared/types/session'

/**
 * The opened checkout for a session.
 *
 * Distinct from {@link resolveSessionWorkingPath}: this is the repository the user opened,
 * never a Session worktree. Worktree birth needs it specifically, because it creates the
 * worktree *from* the primary checkout.
 */
export function requireSessionProjectPath(session: SessionDetail): string {
  const projectPath = session.projectPath
  if (!projectPath) {
    throw new Error('No project path set on the session - cannot run Pi agent')
  }
  return projectPath
}

/**
 * The working tree a Pi agent for this session must run in.
 *
 * Worktree-mode sessions run in their dedicated Session worktree (ADR 0010); local-mode
 * sessions run in the opened checkout unchanged.
 *
 * A recorded worktree that no longer exists throws rather than falling back to the opened
 * checkout. The fallback was silent, and its effect was to hand the agent the user's own
 * checkout as its working directory — the isolation worktree mode exists to provide,
 * removed without anything in the UI saying so. Worktree birth refuses for the same
 * reason, and the composer blocks the send and offers to recreate or switch, so a user
 * who hits this has a way forward that does not involve guessing.
 */
export function resolveSessionWorkingPath(session: SessionDetail): string {
  const projectPath = requireSessionProjectPath(session)
  if (session.environmentMode !== 'worktree') return projectPath

  const worktreePath = session.worktreePath?.trim()
  if (!worktreePath) return projectPath
  if (existsSync(worktreePath)) return worktreePath

  throw new Error(
    "This session's worktree no longer exists. Recreate it, or switch this session to the current checkout.",
  )
}

export function createSessionManagerForSession(session: SessionDetail, projectPath: string) {
  /*
   * A missing transcript file is benign and expected: the session may predate the file,
   * or it may have been cleaned up. Starting a fresh manager loses no user work, unlike a
   * missing worktree, so this fallback stays silent on purpose.
   */
  if (session.piSessionFile && existsSync(session.piSessionFile)) {
    return SessionManager.open(session.piSessionFile, undefined, projectPath)
  }

  const sessionManager = SessionManager.create(projectPath)
  if (session.piSessionId) {
    sessionManager.newSession({ id: session.piSessionId })
  }
  return sessionManager
}
