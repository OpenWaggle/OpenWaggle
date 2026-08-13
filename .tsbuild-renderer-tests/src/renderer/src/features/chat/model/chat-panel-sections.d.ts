import type { AgentSendPayload } from '@shared/types/agent';
import type { AgentLoopInteraction, AgentLoopInteractionResponse } from '@shared/types/agent-loop-interaction';
import type { SessionBranchId, SessionId } from '@shared/types/brand';
import type { UIMessage } from '@shared/types/chat-ui';
import type { ExtensionContributionRegistryView } from '@shared/types/extensions';
import type { SessionDetail } from '@shared/types/session';
import type { SkillDiscoveryItem } from '@shared/types/standards';
import type { AgentTransportCustomEvent } from '@shared/types/stream';
import type { WaggleCollaborationStatus, WaggleConfig } from '@shared/types/waggle';
import type { AgentChatStatus, AgentCompactionStatus } from '../hooks/useAgentChat';
import type { SessionForkTarget } from '../lib/session-fork-targets';
import type { AgentInteractionEvent, ChatRow } from '../lib/types-chat-row';
export interface ChatTranscriptSectionState {
    readonly messages: UIMessage[];
    readonly isLoading: boolean;
    readonly projectPath: string | null;
    readonly recentProjects: readonly string[];
    readonly activeSessionId: SessionId | null;
    readonly chatRows: ChatRow[];
    readonly extensionRegistry: ExtensionContributionRegistryView | null;
    readonly extensionProjectPaths: readonly string[];
    /** The ID of the last user message used to identify stable session hydration for scroll restore. */
    readonly lastUserMessageId: string | null;
    /** Monotonic streaming signal used by scroll-follow without rescanning the full transcript. */
    readonly streamSignalVersion: number;
    /** Intent flag; true when the user pressed Send and consumed by the scroll hook. */
    readonly userDidSend: boolean;
    /** Clears userDidSend after the scroll effect processes it. */
    readonly onUserDidSendConsumed: () => void;
    onOpenProject: () => Promise<void>;
    onSelectProjectPath: (path: string) => void;
    onRetryText: (content: string) => Promise<void>;
    onOpenSettings: () => void;
    onDismissError: (errorId: string | null) => void;
    onDismissInterruptedRun: (runId: string, branchId: SessionBranchId) => void;
    onBranchFromMessage: (messageId: string) => void;
    onForkFromMessage: (messageId: string) => void;
    onViewTurnDiff: (messageId: string) => void;
    readonly turnAnchorMessageIds: ReadonlySet<string>;
}
export interface ChatComposerSectionState {
    readonly activeSessionId: SessionId | null;
    readonly session: SessionDetail | null;
    readonly isFirstMessage: boolean;
    readonly waggleStatus: WaggleCollaborationStatus;
    readonly commandPaletteOpen: boolean;
    readonly slashSkills: readonly SkillDiscoveryItem[];
    readonly isLoading: boolean;
    readonly status: AgentChatStatus;
    readonly compactionStatus: AgentCompactionStatus | null;
    readonly forkSelectorOpen: boolean;
    readonly forkTargets: readonly SessionForkTarget[];
    onStopCollaboration: () => void;
    onSelectSkill: (skillId: string, skillName?: string) => void;
    onStartWaggle: (config: WaggleConfig) => void;
    onSendWithWaggle: (payload: AgentSendPayload) => Promise<void>;
    onSteer: (messageId: string) => Promise<void>;
    onCancel: () => void;
    onToast: (message: string) => void;
    onSkipBranchSummary: () => void;
    onSummarizeBranch: () => void;
    onStartCustomBranchSummary: () => void;
    onCancelBranchSummary: () => void;
    onOpenForkSelector: () => void;
    onCloseForkSelector: () => void;
    onSelectForkTarget: (target: SessionForkTarget) => void;
    onCloneToNewSession: () => void;
}
export interface ChatDiffSectionState {
    /** The working tree this panel reads and mutates (a Session worktree in worktree mode). */
    readonly workingPath: string | null;
    /** The repository the session belongs to, for telling a worktree apart from the checkout. */
    readonly repositoryPath: string | null;
    readonly sessionId: SessionId | null;
    onSendMessage: (content: string) => Promise<void>;
}
export interface ChatPanelSections {
    readonly transcript: ChatTranscriptSectionState;
    readonly composer: ChatComposerSectionState;
    readonly diff: ChatDiffSectionState;
    readonly agentInteractions: readonly AgentLoopInteraction[];
    readonly agentCustomMessages: readonly AgentTransportCustomEvent[];
    readonly agentInteractionEvents: readonly AgentInteractionEvent[];
    readonly extensionRegistry: ExtensionContributionRegistryView | null;
    readonly extensionProjectPaths: readonly string[];
    onRespondAgentInteraction: (interaction: AgentLoopInteraction, response: AgentLoopInteractionResponse) => Promise<void>;
}
