import type { SessionBranchId, SessionId } from '@shared/types/brand';
import type { ArchivedBranchProjectGroup } from './archived-branch-groups';
interface ArchivedBranchGroupProps {
    readonly group: ArchivedBranchProjectGroup;
    readonly onRestoreBranch: (sessionId: SessionId, branchId: SessionBranchId) => void;
}
export declare function ArchivedBranchGroup({ group, onRestoreBranch }: ArchivedBranchGroupProps): import("node_modules/@types/react").JSX.Element;
export {};
