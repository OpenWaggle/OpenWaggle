import type { SessionId } from '@shared/types/brand';
import type { SessionSummary } from '@shared/types/session';
export declare function errorMessage(error: unknown): string;
export declare function clearComposerDraftsForSessions(sessions: readonly Pick<SessionSummary, 'id'>[]): void;
export declare function clearComposerDraftForSession(sessionId: SessionId): void;
