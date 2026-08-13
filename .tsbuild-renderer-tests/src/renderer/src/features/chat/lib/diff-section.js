import { resolveSessionWorkingDir } from '@shared/utils/worktree';
/**
 * Point the diff panel at the tree the session actually runs in.
 *
 * `projectPath` is the working tree the panel reads and mutates — the Session
 * worktree in worktree mode — while `repositoryPath` keeps the repository identity so
 * the panel can tell a worktree apart from the opened checkout and say which one it
 * is showing (ADR 0016).
 */
export function buildDiffSection(input) {
    return {
        projectPath: resolveSessionWorkingDir(input.activeSession, input.projectPath),
        repositoryPath: input.projectPath,
        sessionId: input.sessionId,
        onSendMessage: input.onSendMessage,
    };
}
