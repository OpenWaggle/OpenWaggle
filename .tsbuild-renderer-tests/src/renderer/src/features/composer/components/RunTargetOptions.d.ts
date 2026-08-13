import type { SessionContextRowState } from '@/features/git';
import type { ComposerActionDialogKind } from '../state/composer-action-store';
interface RunTargetOptionsProps {
    readonly strip: SessionContextRowState | null;
    readonly selectedRef: string | null;
    readonly onOpenActionDialog: (kind: ComposerActionDialogKind, initialValue?: string) => void;
    readonly onToast?: (message: string) => void;
}
/**
 * Everything that used to live in the separate "Options" popover, plus the ref
 * actions that belong beside a ref chooser: create-and-switch, copy name,
 * start-from-origin, and change-request checkout. Keeping them here means the row
 * has exactly one popover and the user never has to reconcile two branch controls.
 */
export declare function RunTargetOptions({ strip, selectedRef, onOpenActionDialog, onToast, }: RunTargetOptionsProps): import("node_modules/@types/react").JSX.Element;
export {};
