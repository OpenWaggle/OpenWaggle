import { useEffect, useRef, useState } from 'react';
import { selectWorkingTreeStatus, useGitStore } from '@/features/git';
import { api } from '@/shared/lib/ipc';
import { useUIStore } from '@/shell/ui-store';
function errorMessage(error, fallback) {
    return error instanceof Error && error.message.trim() ? error.message : fallback;
}
export function useDiffPanelGitActions({ projectPath, fallbackHasChanges, canMutateWorkingTree, refreshDiff, }) {
    const [isActionRunning, setIsActionRunning] = useState(false);
    const currentProjectPath = useRef(projectPath);
    useEffect(() => {
        currentProjectPath.current = projectPath;
    }, [projectPath]);
    // Status for the tree this panel is actually showing, not for the project.
    const gitStatus = useGitStore((state) => selectWorkingTreeStatus(state, projectPath).status);
    const refreshGitStatus = useGitStore((state) => state.refreshStatus);
    const showToast = useUIStore((state) => state.showToast);
    async function executeGitAction(projectPathToMutate, action, fallbackError) {
        try {
            const result = await action(projectPathToMutate);
            if (currentProjectPath.current !== projectPathToMutate)
                return;
            if (!result.ok && result.code === 'cancelled')
                return;
            await Promise.all([refreshGitStatus(projectPathToMutate), refreshDiff(projectPathToMutate)]);
            if (currentProjectPath.current !== projectPathToMutate)
                return;
            showToast(result.message, result.ok ? 'success' : 'error');
        }
        catch (error) {
            if (currentProjectPath.current !== projectPathToMutate)
                return;
            showToast(errorMessage(error, fallbackError), 'error');
        }
    }
    function handleRevertAll() {
        if (!projectPath || isActionRunning)
            return;
        setIsActionRunning(true);
        void executeGitAction(projectPath, api.revertAllGitChanges, 'Failed to revert working-tree changes.').finally(() => {
            setIsActionRunning(false);
        });
    }
    function handleStageAll() {
        if (!projectPath || isActionRunning)
            return;
        setIsActionRunning(true);
        void executeGitAction(projectPath, api.stageAllGitChanges, 'Failed to stage working-tree changes.').finally(() => {
            setIsActionRunning(false);
        });
    }
    return {
        canRevertAll: canMutateWorkingTree &&
            projectPath !== null &&
            (gitStatus ? !gitStatus.clean : fallbackHasChanges),
        canStageAll: canMutateWorkingTree &&
            projectPath !== null &&
            (gitStatus ? gitStatus.changedFiles.some((file) => file.unstaged) : fallbackHasChanges),
        isActionRunning,
        handleRevertAll,
        handleStageAll,
    };
}
