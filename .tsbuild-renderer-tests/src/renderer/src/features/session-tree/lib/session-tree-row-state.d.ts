import type { SessionNode } from '@shared/types/session';
import type { SessionTreeRow, SessionTreeRowsView } from '../model';
export declare function buildSessionTreeRowState(input: {
    readonly row: SessionTreeRow;
    readonly view: SessionTreeRowsView;
}): {
    activePath: boolean;
    archivedBranch: import("@shared/types/session").SessionBranch | undefined;
    expanded: boolean;
    isActiveBranchHead: boolean;
    isDraftNode: boolean;
    node: SessionNode;
    nodeBranches: import("@shared/types/session").SessionBranch[];
    nodeHighlighted: boolean;
    rowHighlighted: boolean;
};
