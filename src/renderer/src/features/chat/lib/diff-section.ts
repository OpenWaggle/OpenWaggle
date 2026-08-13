import { resolveSessionWorkingDir } from '@shared/utils/worktree'
import type { ChatDiffSectionState } from '../model'

/**
 * Point the diff panel at the tree the session actually runs in.
 *
 * `workingPath` is the working tree the panel reads and mutates — the Session
 * worktree in worktree mode — while `repositoryPath` keeps the repository identity so
 * the panel can tell a worktree apart from the opened checkout and say which one it
 * is showing (ADR 0016).
 */
export function buildDiffSection(input: {
  readonly activeSession: Parameters<typeof resolveSessionWorkingDir>[0]
  /** The opened checkout. The working tree is derived from it and the session. */
  readonly projectPath: string | null
  readonly sessionId: ChatDiffSectionState['sessionId']
  readonly onSendMessage: ChatDiffSectionState['onSendMessage']
}): ChatDiffSectionState {
  return {
    workingPath: resolveSessionWorkingDir(input.activeSession, input.projectPath),
    repositoryPath: input.projectPath,
    sessionId: input.sessionId,
    onSendMessage: input.onSendMessage,
  }
}
