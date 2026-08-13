import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef, useState } from 'react';
import { useDiffPanelGitActions } from '@/features/diff-panel/hooks/useDiffPanelGitActions';
import { codeViewItemId } from '@/features/diff-panel/lib/code-view-items';
import { selectThreadDiffScopeSelection, useDiffScopeStore, } from '@/features/diff-panel/state/diff-scope-store';
import { useCombinedVcsStatus, useStackedGitActions } from '@/features/git';
import { useBaseRefChoices } from '../hooks/useBaseRefChoices';
import { useDiffPanelDiffs } from '../hooks/useDiffPanelDiffs';
import { useReconcileTurnSelection } from '../hooks/useReconcileTurnSelection';
import { useSessionTurns, useTurnDiffFiles } from '../hooks/useSessionTurns';
import { CommitMessageDialog } from './CommitMessageDialog';
import { DiffBottomBar } from './DiffBottomBar';
import { DiffPanelHeader } from './DiffPanelHeader';
import { DiffReviewBody } from './DiffReviewBody';
export function DiffPanel({ workingPath, sessionId = null, onSendMessage }) {
    const viewerRef = useRef(null);
    const scopeByThreadKey = useDiffScopeStore((s) => s.byThreadKey);
    const selectGitScope = useDiffScopeStore((s) => s.selectGitScope);
    const selectBranchBaseRef = useDiffScopeStore((s) => s.selectBranchBaseRef);
    const selectTurn = useDiffScopeStore((s) => s.selectTurn);
    const scopeKey = sessionId ?? workingPath ?? '';
    const selection = selectThreadDiffScopeSelection(scopeByThreadKey, scopeKey || null, true);
    const branchBaseRef = selection.kind === 'branch' ? selection.baseRef : null;
    const baseRefChoices = useBaseRefChoices(workingPath);
    const turns = useSessionTurns(sessionId);
    const branchOrTreeDiffs = useDiffPanelDiffs(workingPath, selection);
    const turnFiles = useTurnDiffFiles(sessionId, selection);
    const fileDiffs = selection.kind === 'turn' ? turnFiles : branchOrTreeDiffs.fileDiffs;
    const isLoading = selection.kind === 'turn' ? false : branchOrTreeDiffs.isLoading;
    const refreshDiff = branchOrTreeDiffs.refreshDiff;
    useReconcileTurnSelection(scopeKey, turns);
    /** Jump the virtualized list to a file's section. */
    function handleFileClick(path) {
        viewerRef.current?.scrollTo({ type: 'item', id: codeViewItemId(path), align: 'start' });
    }
    function handleSelectScope(scope) {
        if (scope === 'turn') {
            const latestTurn = turns.at(-1);
            if (latestTurn)
                selectTurn(scopeKey, latestTurn.turnId);
            return;
        }
        selectGitScope(scopeKey, scope);
    }
    const gitActions = useDiffPanelGitActions({
        workingPath,
        fallbackHasChanges: selection.kind === 'unstaged' && fileDiffs.length > 0,
        canMutateWorkingTree: selection.kind === 'unstaged',
        refreshDiff,
    });
    const { status: vcsStatus, refresh: refreshVcsStatus } = useCombinedVcsStatus(workingPath);
    const stackedActions = useStackedGitActions({
        projectPath: workingPath,
        onCompleted: () => {
            if (workingPath)
                void refreshDiff(workingPath);
            void refreshVcsStatus();
        },
    });
    const [pendingCommitAction, setPendingCommitAction] = useState(null);
    const selectedPaths = fileDiffs.map((file) => file.path);
    /**
     * Commit-bearing actions must collect an explicit message first (review B2);
     * everything else dispatches immediately. Only the visible selection is staged.
     */
    function requestStackedAction(action) {
        if (action.startsWith('commit')) {
            setPendingCommitAction(action);
            return;
        }
        void stackedActions.run(action, { paths: selectedPaths });
    }
    return (_jsxs("div", { className: "relative flex flex-col size-full bg-diff-bg", children: [workingPath ? (_jsx(DiffPanelHeader, { selection: selection, baseRef: branchBaseRef, baseRefChoices: baseRefChoices, turns: turns, onSelectScope: handleSelectScope, onChangeBaseRef: (baseRef) => selectBranchBaseRef(scopeKey, baseRef), onSelectTurn: (turnId) => selectTurn(scopeKey, turnId) })) : null, _jsx(DiffReviewBody, { viewerRef: viewerRef, files: fileDiffs, isLoading: isLoading, onSendMessage: onSendMessage, onFileClick: handleFileClick }), _jsx(DiffBottomBar, { onRevertAll: gitActions.handleRevertAll, onStageAll: gitActions.handleStageAll, canRevertAll: gitActions.canRevertAll, canStageAll: gitActions.canStageAll, isActionRunning: gitActions.isActionRunning, quickAction: {
                    status: vcsStatus,
                    isBusy: stackedActions.isRunning,
                    onRunAction: (action) => requestStackedAction(action),
                    onPull: () => stackedActions.run('pull'),
                    onOpenChangeRequest: () => {
                        const url = vcsStatus?.changeRequest?.url;
                        if (url)
                            window.open(url, '_blank', 'noopener');
                    },
                    onPublish: () => stackedActions.run('push'),
                } }), _jsx(CommitMessageDialog, { open: pendingCommitAction !== null, fileCount: selectedPaths.length, onCancel: () => setPendingCommitAction(null), onConfirm: (commitMessage) => {
                    const action = pendingCommitAction;
                    setPendingCommitAction(null);
                    if (action)
                        void stackedActions.run(action, { paths: selectedPaths, commitMessage });
                } })] }));
}
