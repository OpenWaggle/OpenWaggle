import type { MessagePart } from '@shared/types/agent';
import type { UIMessage } from '@shared/types/chat-ui';
import type { SessionDetail } from '@shared/types/session';
/**
 * Convert a persisted agent message part into renderer UI parts.
 * This is the boundary between storage transport shapes and chat presentation state.
 */
export declare function messagePartToUIParts(part: MessagePart): UIMessage['parts'];
export declare function sessionToUIMessages(session: SessionDetail): UIMessage[];
export declare function buildPartialAssistantMessage(parts: readonly MessagePart[], messageId?: string): UIMessage | null;
