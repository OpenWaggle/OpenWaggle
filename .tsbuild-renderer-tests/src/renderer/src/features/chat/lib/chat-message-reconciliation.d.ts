import type { UIMessage } from '@shared/types/chat-ui';
/**
 * Keeps optimistic user rows visible until the persisted session snapshot catches up.
 * Matching is text-based because optimistic and persisted IDs are intentionally different.
 */
export declare function appendMissingOptimisticUserMessages(snapshotMessages: UIMessage[], optimisticUserMessages: readonly UIMessage[]): UIMessage[];
/**
 * Replaces persisted user rows with matching in-memory optimistic rows so React row
 * identity remains stable across the post-run snapshot refresh.
 */
export declare function reconcileSnapshotUserMessages(snapshotMessages: UIMessage[], existingMessages: UIMessage[]): UIMessage[];
export declare function appendUnpersistedAssistantTail(snapshotMessages: UIMessage[], existingMessages: readonly UIMessage[]): UIMessage[];
