import type { SessionBranchId, SessionId } from '@shared/types/brand';
import type { ProjectGroup } from '@/features/sidebar/lib';
import type { ArchivedBranchProjectGroup } from './archived-branch-groups';
interface ArchivedSectionContentProps {
    readonly groups: readonly ProjectGroup[];
    readonly branchGroups: readonly ArchivedBranchProjectGroup[];
    readonly actionError: string | null;
    readonly queryError: string | null;
    readonly onRestore: (id: SessionId) => void;
    readonly onDelete: (id: SessionId) => void;
    readonly onRestoreBranch: (sessionId: SessionId, branchId: SessionBranchId) => void;
}
export declare function ArchivedSectionContent({ groups, branchGroups, actionError, queryError, onRestore, onDelete, onRestoreBranch, }: ArchivedSectionContentProps): import("node_modules/@types/react").JSX.Element;
export {};
