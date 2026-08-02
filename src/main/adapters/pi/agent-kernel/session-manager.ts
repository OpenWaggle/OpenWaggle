import { existsSync } from 'node:fs'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import type { SessionDetail } from '@shared/types/session'

export function resolveSessionProjectPath(session: SessionDetail) {
  const projectPath = session.projectPath
  if (!projectPath) {
    throw new Error('No project path set on the session - cannot run Pi agent')
  }
  // Worktree-mode sessions run in their dedicated Session worktree (ADR 0010);
  // local-mode sessions (the default) run in the opened checkout unchanged.
  const worktreePath = session.worktreePath?.trim()
  if (session.environmentMode === 'worktree' && worktreePath && existsSync(worktreePath)) {
    return worktreePath
  }
  return projectPath
}

export function createSessionManagerForSession(session: SessionDetail, projectPath: string) {
  if (session.piSessionFile && existsSync(session.piSessionFile)) {
    return SessionManager.open(session.piSessionFile, undefined, projectPath)
  }

  const sessionManager = SessionManager.create(projectPath)
  if (session.piSessionId) {
    sessionManager.newSession({ id: session.piSessionId })
  }
  return sessionManager
}
