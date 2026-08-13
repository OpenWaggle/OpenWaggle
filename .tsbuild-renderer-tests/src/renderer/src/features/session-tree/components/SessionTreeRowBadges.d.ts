import type { SessionBranch } from '@shared/types/session';
interface SessionTreeRowBadgesProps {
    readonly archivedBranch: SessionBranch | undefined;
    readonly childPathCount: number;
    readonly isActiveBranchHead: boolean;
    readonly isDraftNode: boolean;
    readonly nodeBranches: readonly SessionBranch[];
}
export declare function SessionTreeRowBadges({ archivedBranch, childPathCount, isActiveBranchHead, isDraftNode, nodeBranches, }: SessionTreeRowBadgesProps): import("node_modules/@types/react").JSX.Element;
export {};
