import type { UIMessage } from '@shared/types/chat-ui';
import type { SessionDetail } from '@shared/types/session';
import { type WaggleMessageMetadata } from '@shared/types/waggle';
/**
 * Derives a UIMessage-id -> Waggle metadata lookup without broad subscriptions
 * or position-only attribution. Live stream metadata wins, persisted metadata is
 * the historical source of truth, and current-agent hints are only a live fallback.
 */
export declare function useWaggleMetadataLookup(session: SessionDetail | null, messages: UIMessage[]): Readonly<Record<string, WaggleMessageMetadata>>;
