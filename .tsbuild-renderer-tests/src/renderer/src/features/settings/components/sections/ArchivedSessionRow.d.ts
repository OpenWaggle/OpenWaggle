import type { SessionId } from '@shared/types/brand';
import type { SessionSummary } from '@shared/types/session';
interface ArchivedSessionRowProps {
    readonly session: SessionSummary;
    readonly onRestore: (id: SessionId) => void;
    readonly onDelete: (id: SessionId) => void;
}
export declare function ArchivedSessionRow({ session, onRestore, onDelete }: ArchivedSessionRowProps): import("node_modules/@types/react").JSX.Element;
export {};
