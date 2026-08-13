import type { SessionId, SessionNodeId } from '@shared/types/brand';
import type { UIMessage } from '@shared/types/chat-ui';
import type { SessionWorkspace } from '@shared/types/session';
interface ResolveTranscriptMessagesInput {
    readonly activeSessionId: SessionId | null;
    readonly activeWorkspace: SessionWorkspace | null;
    readonly messages: UIMessage[];
    readonly draftBranchSourceNodeId?: SessionNodeId | null;
}
export declare function resolveTranscriptMessages({ activeSessionId, activeWorkspace, messages, draftBranchSourceNodeId, }: ResolveTranscriptMessagesInput): UIMessage[];
export {};
