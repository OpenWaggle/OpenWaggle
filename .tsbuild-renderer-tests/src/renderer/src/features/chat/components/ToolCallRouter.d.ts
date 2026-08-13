import type { SessionId } from '@shared/types/brand';
import type { UIMessage } from '@shared/types/chat-ui';
import type { ExtensionContributionRegistryView } from '@shared/types/extensions';
interface ToolCallRouterProps {
    part: Extract<UIMessage['parts'][number], {
        type: 'tool-call';
    }>;
    toolResults: Map<string, {
        content: unknown;
        state: string;
        sourceMessageId?: string;
        error?: string;
    }>;
    sessionId: SessionId | null;
    isStreaming: boolean;
    extensionRegistry?: ExtensionContributionRegistryView | null;
    extensionProjectPaths?: readonly string[];
    onBranchFromMessage?: (messageId: string) => void;
}
export declare function ToolCallRouter({ part, toolResults, sessionId: _sessionId, isStreaming, extensionRegistry, extensionProjectPaths, onBranchFromMessage, }: ToolCallRouterProps): import("node_modules/@types/react").JSX.Element;
export {};
