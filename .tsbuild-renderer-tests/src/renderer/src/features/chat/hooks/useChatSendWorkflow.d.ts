import type { AgentSendPayload } from '@shared/types/agent';
import type { SessionId, SupportedModelId } from '@shared/types/brand';
import type { ExtensionContributionRegistryView } from '@shared/types/extensions';
import type { WaggleCollaborationStatus, WaggleConfig } from '@shared/types/waggle';
import type { useBranchSummaryWorkflow } from './useBranchSummaryWorkflow';
import type { useSessionCopyWorkflow } from './useSessionCopyWorkflow';
interface ChatSendWorkflowParams {
    readonly activeSessionId: SessionId | null;
    readonly branchSummary: ReturnType<typeof useBranchSummaryWorkflow>;
    readonly clearDraftBranchForSession: (sessionId: SessionId) => void;
    readonly draftBranch: Parameters<ReturnType<typeof useBranchSummaryWorkflow>['materializeDraftBranchForSend']>[0];
    readonly extensionContributions: ExtensionContributionRegistryView | null;
    readonly handleSend: (payload: AgentSendPayload) => Promise<void>;
    readonly handleSendWaggle: (payload: AgentSendPayload, config: WaggleConfig) => Promise<void>;
    readonly model: SupportedModelId;
    readonly phase: {
        readonly reset: () => void;
    };
    readonly projectPath: string | null;
    readonly refreshSession: (sessionId: SessionId) => Promise<void>;
    readonly refreshSessionWorkspace: (sessionId: SessionId) => Promise<void>;
    readonly sessionCopy: ReturnType<typeof useSessionCopyWorkflow>;
    readonly setUserDidSend: (value: boolean) => void;
    readonly setWaggleConfig: (config: WaggleConfig, sessionId: SessionId | null) => void;
    readonly showToast: (message: string) => void;
    readonly startWaggleCollaboration: (sessionId: SessionId, config: WaggleConfig) => void;
    readonly stop: () => void;
    readonly stopWaggleCollaboration: () => void;
    readonly waggleConfig: WaggleConfig | null;
    readonly waggleOwningId: SessionId | null;
    readonly waggleStatus: WaggleCollaborationStatus;
}
export declare function useChatSendWorkflow(params: ChatSendWorkflowParams): {
    sendWithWaggle(payload: AgentSendPayload): Promise<void>;
    cancelRun(): void;
    startWaggle(config: WaggleConfig): void;
    stopCollaboration(): void;
};
export {};
