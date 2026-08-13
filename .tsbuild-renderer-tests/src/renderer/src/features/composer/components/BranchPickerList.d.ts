import type { GitBranchInfo } from '@shared/types/git';
interface BranchPickerListProps {
    readonly filteredBranches: readonly GitBranchInfo[];
    readonly localBranches: readonly GitBranchInfo[];
    readonly remoteBranches: readonly GitBranchInfo[];
    readonly selectedRef: string | null;
    readonly onSelectRef: (branchName: string) => void;
}
export declare function BranchPickerList({ filteredBranches, localBranches, remoteBranches, selectedRef, onSelectRef, }: BranchPickerListProps): import("node_modules/@types/react").JSX.Element;
export {};
