import type { ComposerActionDialogKind } from '../state/composer-action-store';
export interface ActionDialogConfig {
    readonly title: string;
    readonly description: string;
    readonly confirmLabel: string;
    readonly confirmTone: 'normal' | 'danger';
    readonly inputPlaceholder?: string;
}
export declare function getActionDialogConfig(kind: ComposerActionDialogKind): {
    readonly title: "Create branch";
    readonly description: "Create and checkout a new branch from the current HEAD.";
    readonly confirmLabel: "Create";
    readonly confirmTone: "normal";
    readonly inputPlaceholder: "feature/my-branch";
};
export declare function actionDialogHasInput(kind: ComposerActionDialogKind | null): kind is "create-branch";
