import type { SessionId } from '@shared/types/brand';
/**
 * Subscribe to Waggle IPC events and route them to the collaboration store.
 * Tracks both turn events (status changes) and stream chunks (live message metadata).
 */
export declare function useWaggleChat(sessionId: SessionId | null): void;
