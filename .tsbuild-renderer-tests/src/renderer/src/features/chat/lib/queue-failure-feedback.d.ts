import type { AgentSendPayload } from '@shared/types/agent';
import type { SessionId } from '@shared/types/brand';
import type { Logger } from '@shared/types/logger';
interface QueueFailureFeedbackDeps {
    readonly logger: Logger;
    readonly showToast: (message: string) => void;
}
export declare function reportAutoSendQueueFailure(deps: QueueFailureFeedbackDeps, sessionId: SessionId | null, payload: AgentSendPayload, error: unknown): void;
export declare function reportQueuedSteerFailure(deps: QueueFailureFeedbackDeps, sessionId: SessionId, messageId: string, error: unknown): void;
export {};
