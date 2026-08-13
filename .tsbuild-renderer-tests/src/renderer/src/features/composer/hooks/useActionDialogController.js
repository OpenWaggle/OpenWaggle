import { match } from '@diegogbrisa/ts-match';
import { useEffect, useRef } from 'react';
import { useGit } from '@/features/git/hooks';
import { runBranchMutation } from '@/features/git/lib';
import { useProject } from '@/features/sessions/hooks';
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey';
import { actionDialogHasInput, getActionDialogConfig } from '../lib/action-dialog-config';
import { useComposerActionStore, } from '../state/composer-action-store';
const NO_PROJECT_RESULT = {
    ok: false,
    code: 'unknown',
    message: 'No project selected.',
};
export function useActionDialogController({ onToast }) {
    const actionDialog = useComposerActionStore((s) => s.actionDialog);
    const actionDialogInput = useComposerActionStore((s) => s.actionDialogInput);
    const actionDialogError = useComposerActionStore((s) => s.actionDialogError);
    const actionDialogBusy = useComposerActionStore((s) => s.actionDialogBusy);
    const closeActionDialog = useComposerActionStore((s) => s.closeActionDialog);
    const setActionDialogInput = useComposerActionStore((s) => s.setActionDialogInput);
    const setActionDialogError = useComposerActionStore((s) => s.setActionDialogError);
    const setActionDialogBusy = useComposerActionStore((s) => s.setActionDialogBusy);
    const { projectPath } = useProject();
    const git = useGit();
    const inputRef = useRef(null);
    const gitBranch = git.status?.branch ?? null;
    const hasInput = actionDialogHasInput(actionDialog);
    const config = actionDialog ? getActionDialogConfig(actionDialog) : null;
    useEscapeHotkey(closeDialogIfIdle, { enabled: actionDialog !== null });
    useEffect(() => {
        if (hasInput)
            requestAnimationFrame(() => inputRef.current?.focus());
    }, [hasInput]);
    function closeDialogIfIdle() {
        if (useComposerActionStore.getState().actionDialogBusy)
            return;
        closeActionDialog();
    }
    async function handleConfirm() {
        if (!actionDialog)
            return;
        setActionDialogError(null);
        setActionDialogBusy(true);
        try {
            const mutation = createActionDialogMutation({
                kind: actionDialog,
                actionDialogInput,
                gitBranch,
                projectPath,
                git,
                setActionDialogError,
                onToast,
            });
            if (mutation)
                await closeDialogOnMutationResult(mutation, closeActionDialog, setActionDialogError);
        }
        catch (error) {
            setActionDialogError(error instanceof Error ? error.message : 'Action failed.');
        }
        finally {
            setActionDialogBusy(false);
        }
    }
    return {
        actionDialog,
        actionDialogInput,
        actionDialogError,
        actionDialogBusy,
        closeActionDialog,
        setActionDialogInput,
        inputRef,
        config,
        handleConfirm,
    };
}
async function closeDialogOnMutationResult(resultPromise, closeActionDialog, setActionDialogError) {
    const errorMessage = await match
        .promise(resultPromise)
        .with({ ok: true }, () => null)
        .with({ ok: false }, (result) => result.message)
        .exhaustive();
    if (errorMessage) {
        setActionDialogError(errorMessage);
        return;
    }
    closeActionDialog();
}
function createActionDialogMutation(input) {
    return match(input.kind)
        .with('create-branch', () => createBranchMutation(input))
        .exhaustive();
}
function createBranchMutation({ actionDialogInput, git, setActionDialogError, onToast, }) {
    const name = actionDialogInput.trim();
    if (!name) {
        setActionDialogError('Branch name is required.');
        return null;
    }
    const workingPath = git.workingPath;
    return runBranchMutation(() => workingPath
        ? git.createBranch(workingPath, { name, checkout: true })
        : Promise.resolve(NO_PROJECT_RESULT), onToast);
}
