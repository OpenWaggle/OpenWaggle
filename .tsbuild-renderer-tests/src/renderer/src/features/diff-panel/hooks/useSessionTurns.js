import { splitUnifiedDiffIntoFileDiffs } from '@shared/utils/turn-diff-parse';
import { useEffect, useState } from 'react';
import { api } from '@/shared/lib/ipc';
import { createRendererLogger } from '@/shared/lib/logger';
const logger = createRendererLogger('diff-panel-turns');
const EMPTY_TURNS = [];
const EMPTY_FILES = [];
/** List the session's Turn checkpoints (WS6b/WS7), oldest first (ascending turn index). */
export function useSessionTurns(sessionId, refreshToken = 0) {
    const [turns, setTurns] = useState(EMPTY_TURNS);
    useEffect(() => {
        if (!sessionId) {
            setTurns(EMPTY_TURNS);
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const result = await api.listTurnCheckpoints(sessionId);
                if (!cancelled)
                    setTurns(result);
            }
            catch (error) {
                // refreshToken forces a refetch when a run completes (review renderer-M2).
                logger.warn('Failed to list turn checkpoints', { error: String(error), refreshToken });
                if (!cancelled)
                    setTurns(EMPTY_TURNS);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [sessionId, refreshToken]);
    return turns;
}
/** Fetch and shape the Turn diff for the selected turn into renderable files. */
export function useTurnDiffFiles(sessionId, selection) {
    const [files, setFiles] = useState(EMPTY_FILES);
    const turnId = selection.kind === 'turn' ? selection.turnId : null;
    useEffect(() => {
        if (!sessionId || !turnId) {
            setFiles(EMPTY_FILES);
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const turnDiff = await api.getTurnDiff(sessionId, turnId);
                if (cancelled)
                    return;
                const fileDiffs = turnDiff
                    ? splitUnifiedDiffIntoFileDiffs(turnDiff.diff).map((diff) => ({
                        ...diff,
                    }))
                    : EMPTY_FILES;
                setFiles(fileDiffs);
            }
            catch (error) {
                logger.warn('Failed to load turn diff', { error: String(error) });
                if (!cancelled)
                    setFiles(EMPTY_FILES);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [sessionId, turnId]);
    return files;
}
