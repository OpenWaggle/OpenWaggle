import type { SessionContextRowState } from '@/features/git';
interface RunTargetPickerProps {
    readonly strip: SessionContextRowState | null;
    readonly onToast?: (message: string) => void;
}
/**
 * The single ref chooser for the composer row: one control, one question — which
 * ref does the next send run on?
 *
 * Selecting a ref means different things per environment mode, and that is the
 * point of merging the two old controls: running in place checks the ref out,
 * while creating a worktree records it as the base to branch from. Previously
 * those were two chips showing the same branch string with no indication of
 * which one governed the send.
 */
export declare function RunTargetPicker({ strip, onToast }: RunTargetPickerProps): import("node_modules/@types/react").JSX.Element | null;
export {};
