import { match } from '@diegogbrisa/ts-match';
export function getActionDialogConfig(kind) {
    return match(kind)
        .with('create-branch', () => ({
        title: 'Create branch',
        description: 'Create and checkout a new branch from the current HEAD.',
        confirmLabel: 'Create',
        confirmTone: 'normal',
        inputPlaceholder: 'feature/my-branch',
    }))
        .exhaustive();
}
export function actionDialogHasInput(kind) {
    return kind === 'create-branch';
}
