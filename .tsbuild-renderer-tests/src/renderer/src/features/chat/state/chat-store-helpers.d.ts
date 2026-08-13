import { SessionId } from '@shared/types/brand';
import type { SessionDetail, SessionSummary } from '@shared/types/session';
export declare function toSessionId(id: SessionId): SessionId;
export declare function optionalSessionId(id: SessionId | null): SessionId | null;
export declare function isSameSessionId(left: SessionId | null, right: SessionId): boolean;
export declare function refreshSessionStoreForSession(sessionId: SessionId, activeSessionId: SessionId | null): void;
export declare function handleStoreError(err: unknown, action: string, setError: (message: string) => void): void;
export declare function toSummary(session: SessionDetail): {
    id: SessionId;
    title: string;
    projectPath: string | null;
    messageCount: number;
    archived: boolean | undefined;
    createdAt: number;
    updatedAt: number;
};
export declare function mergeSummary(summaries: readonly SessionSummary[], summary: SessionSummary): SessionSummary[];
export declare function removeSummary(summaries: readonly SessionSummary[], id: SessionId): SessionSummary[];
