import { matchBy } from '@diegogbrisa/ts-match';
import { useEffect, useReducer, useRef } from 'react';
import { api } from '@/shared/lib/ipc';
function diffPanelReducer(state, action) {
    return matchBy(action, 'type')
        .with('clear', () => ({ fileDiffs: [], isLoading: false, error: null }))
        .with('start-loading', () => ({ ...state, isLoading: true }))
        .with('load-success', (value) => ({
        ...state,
        fileDiffs: value.fileDiffs,
        isLoading: false,
        error: null,
    }))
        .with('load-failure', (value) => ({
        ...state,
        fileDiffs: [],
        isLoading: false,
        error: value.error,
    }))
        .exhaustive();
}
function isStaleDiffRequest(requestId, latestRequestId, currentWorkingPath, requestedWorkingPath) {
    return requestId !== latestRequestId || currentWorkingPath !== requestedWorkingPath;
}
function fetchDiffsForScope(workingPath, selection) {
    if (selection.kind === 'branch') {
        return api.getGitBranchDiff(workingPath, selection.baseRef ?? '');
    }
    return api.getGitDiff(workingPath);
}
/**
 * Load and refresh diffs for the active scope (working tree or branch-vs-base).
 *
 * The path is a **working path**, not a project path: for a worktree-mode session it is
 * the Session worktree. Naming it precisely matters here because reading the project
 * path instead is exactly the defect ADR 0016 fixed.
 */
export function useDiffPanelDiffs(workingPath, selection) {
    const [state, dispatch] = useReducer(diffPanelReducer, {
        fileDiffs: [],
        isLoading: false,
        error: null,
    });
    const currentWorkingPath = useRef(workingPath);
    const diffRequestId = useRef(0);
    const selectionRef = useRef(selection);
    useEffect(() => {
        selectionRef.current = selection;
    }, [selection]);
    useEffect(() => {
        currentWorkingPath.current = workingPath;
    }, [workingPath]);
    const scopeKind = selection.kind;
    const branchBaseRef = selection.kind === 'branch' ? (selection.baseRef ?? '') : '';
    useEffect(() => {
        diffRequestId.current += 1;
        const requestId = diffRequestId.current;
        if (!workingPath) {
            dispatch({ type: 'clear' });
            return;
        }
        const scopedSelection = scopeKind === 'branch' ? { kind: 'branch', baseRef: branchBaseRef } : { kind: 'unstaged' };
        dispatch({ type: 'start-loading' });
        let cancelled = false;
        fetchDiffsForScope(workingPath, scopedSelection)
            .then((result) => {
            if (cancelled || requestId !== diffRequestId.current)
                return;
            dispatch(result.ok
                ? { type: 'load-success', fileDiffs: result.files }
                : { type: 'load-failure', error: result.message });
        })
            .catch(() => {
            // Only an unexpected transport failure reaches here now; expected git
            // failures arrive as { ok: false } above.
            if (cancelled || requestId !== diffRequestId.current)
                return;
            dispatch({ type: 'load-failure', error: null });
        });
        return () => {
            cancelled = true;
        };
    }, [workingPath, scopeKind, branchBaseRef]);
    async function refreshDiff(projectPathToRefresh) {
        diffRequestId.current += 1;
        const requestId = diffRequestId.current;
        dispatch({ type: 'start-loading' });
        try {
            const result = await fetchDiffsForScope(projectPathToRefresh, selectionRef.current);
            if (isStaleDiffRequest(requestId, diffRequestId.current, currentWorkingPath.current, projectPathToRefresh))
                return;
            dispatch(result.ok
                ? { type: 'load-success', fileDiffs: result.files }
                : { type: 'load-failure', error: result.message });
        }
        catch {
            if (isStaleDiffRequest(requestId, diffRequestId.current, currentWorkingPath.current, projectPathToRefresh))
                return;
            dispatch({ type: 'load-failure', error: null });
        }
    }
    return { ...state, refreshDiff };
}
