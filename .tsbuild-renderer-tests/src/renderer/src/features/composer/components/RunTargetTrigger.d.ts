interface RunTargetTriggerProps {
    readonly selectedRef: string | null;
    readonly isOpen: boolean;
    readonly isMissing: boolean;
    readonly onToggle: (open: boolean) => void;
}
/**
 * The one control that answers "which ref does my next send run on?".
 *
 * It deliberately shows the resolved ref for the current environment mode: the
 * checked-out branch when running in place, the chosen base ref when a worktree
 * will be created. Showing the same branch string in two places is what made the
 * old two-control row ambiguous.
 */
export declare function RunTargetTrigger({ selectedRef, isOpen, isMissing, onToggle, }: RunTargetTriggerProps): import("node_modules/@types/react").JSX.Element;
export {};
