import type { SessionId } from '@shared/types/brand';
import type { UIMessage } from '@shared/types/chat-ui';
import type { ExtensionContributionRegistryView } from '@shared/types/extensions';
import type { SupportedModelId } from '@shared/types/llm';
import { type WaggleInfo } from './AssistantMessageBubble';
export interface MessageBubbleRuntime {
    readonly sessionId: SessionId | null;
    readonly extensions: {
        readonly registry: ExtensionContributionRegistryView | null;
        readonly projectPaths: readonly string[];
    };
}
interface MessageBubbleProps {
    message: UIMessage;
    runtime: MessageBubbleRuntime;
    waggle?: WaggleInfo;
    run?: {
        readonly isStreaming?: boolean;
        readonly isRunActive?: boolean;
        readonly assistantModel?: SupportedModelId;
    };
    presentation?: {
        readonly hideAgentLabel?: boolean;
    };
    actions?: {
        readonly onBranchFromMessage?: (messageId: string) => void;
        readonly onForkFromMessage?: (messageId: string) => void;
        readonly onViewTurnDiff?: (messageId: string) => void;
        readonly turnAnchorMessageIds?: ReadonlySet<string>;
    };
}
export declare function MessageBubble({ message, runtime, waggle, run, presentation, actions, }: MessageBubbleProps): import("node_modules/@types/react").JSX.Element;
export {};
