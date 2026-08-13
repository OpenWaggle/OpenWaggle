import type { AgentSendPayload, AttachmentRecord } from '@shared/types/agent';
import type { UIMessage } from '@shared/types/chat-ui';
/** Prefix used to identify attachment text parts in UIMessage rendering. */
export declare const ATTACHMENT_TEXT_PREFIX = "[Attachment] ";
export declare function formatAttachmentPreview(attachment: Pick<AttachmentRecord, 'name' | 'extractedText' | 'origin'>): string;
export declare function buildClientUserMessage(payload: AgentSendPayload): string;
export declare function createOptimisticUserMessage(payload: AgentSendPayload): UIMessage;
