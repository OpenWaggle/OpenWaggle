import { resolveSessionWorkingDir } from '@shared/utils/worktree';
import type { ChatDiffSectionState } from '../model';
/**
 * Point the diff panel at the tree the session actually runs in.
 *
 * `projectPath` is the working tree the panel reads and mutates — the Session
 * worktree in worktree mode — while `repositoryPath` keeps the repository identity so
 * the panel can tell a worktree apart from the opened checkout and say which one it
 * is showing (ADR 0016).
 */
export declare function buildDiffSection(input: {
    readonly activeSession: Parameters<typeof resolveSessionWorkingDir>[0];
    readonly projectPath: string | null;
    readonly sessionId: ChatDiffSectionState['sessionId'];
    readonly onSendMessage: ChatDiffSectionState['onSendMessage'];
}): ChatDiffSectionState;
