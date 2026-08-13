import type { SessionId } from '@shared/types/brand';
import type { GitFileDiff } from '@shared/types/git';
import type { TurnCheckpointSummary } from '@shared/types/turn-diff';
import type { DiffScopeSelection } from '@/features/diff-panel/state/diff-scope-store';
/** List the session's Turn checkpoints (WS6b/WS7), oldest first (ascending turn index). */
export declare function useSessionTurns(sessionId: SessionId | null, refreshToken?: number): readonly TurnCheckpointSummary[];
/** Fetch and shape the Turn diff for the selected turn into renderable files. */
export declare function useTurnDiffFiles(sessionId: SessionId | null, selection: DiffScopeSelection): readonly GitFileDiff[];
