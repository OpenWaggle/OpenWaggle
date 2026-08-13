import type { SessionId } from '@shared/types/brand';
import type { UIMessage } from '@shared/types/chat-ui';
import type { ExtensionContributionRegistryView } from '@shared/types/extensions';
import type { SupportedModelId } from '@shared/types/llm';
import type { WaggleAgentColor } from '@shared/types/waggle';
import React from 'react';
export interface WaggleInfo {
    agentLabel: string;
    agentColor: WaggleAgentColor;
}
interface AssistantMessageBubbleProps {
    message: UIMessage;
    runtime: {
        readonly sessionId: SessionId | null;
        readonly extensions: {
            readonly registry: ExtensionContributionRegistryView | null;
            readonly projectPaths: readonly string[];
        };
    };
    run?: {
        readonly isStreaming?: boolean;
        readonly isRunActive?: boolean;
        readonly assistantModel?: SupportedModelId;
    };
    waggle?: WaggleInfo;
    presentation?: {
        readonly hideAgentLabel?: boolean;
    };
    actions?: {
        readonly onBranchFromMessage?: (messageId: string) => void;
        readonly onViewTurnDiff?: (messageId: string) => void;
    };
}
export declare function AssistantMessageBubble({ message, runtime, run, waggle, presentation, actions, }: AssistantMessageBubbleProps): React.JSX.Element;
export {};
