import type { AgentSendPayload } from '@shared/types/agent';
import type { SessionId } from '@shared/types/brand';
interface SteerWorkflowDeps {
    readonly activeSessionId: SessionId | null;
    readonly steer: () => Promise<void>;
    readonly previewSteeredUserTurn: (payload: AgentSendPayload) => () => void;
    readonly withDeferredSnapshotRefresh: <T>(operation: () => Promise<T>) => Promise<T>;
    readonly handleSendWithWaggle: (payload: AgentSendPayload) => Promise<void>;
    readonly showToast: (message: string) => void;
}
interface SteerWorkflowReturn {
    readonly isSteering: boolean;
    readonly handleSteer: (messageId: string) => Promise<void>;
}
export declare function useSteerWorkflow(deps: SteerWorkflowDeps): SteerWorkflowReturn;
export {};
