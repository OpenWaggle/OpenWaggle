import type { SessionBranchId, SessionId } from '@shared/types/brand';
import type { SessionSummary } from '@shared/types/session';
interface ArchivedBranchSessionProps {
    readonly session: SessionSummary;
    readonly onRestoreBranch: (sessionId: SessionId, branchId: SessionBranchId) => void;
}
export declare function ArchivedBranchSession({ session, onRestoreBranch }: ArchivedBranchSessionProps): import("node_modules/@types/react").JSX.Element;
export {};
