import type { SessionBranchId, SessionId } from '@shared/types/brand';
import type { ExtensionContributionRegistryView } from '@shared/types/extensions';
import type { ChatRow } from '../lib/types-chat-row';
import type { ChatRowRenderContext } from './ChatRowRenderContext';
interface ChatRowRendererProps {
    row: ChatRow;
    context?: ChatRowRenderContext;
    sessionId?: SessionId | null;
    extensionRegistry?: ExtensionContributionRegistryView | null;
    extensionProjectPaths?: readonly string[];
    onOpenSettings?: () => void;
    onRetry?: (content: string) => void;
    onDismissError?: (message: string) => void;
    onDismissInterruptedRun?: (runId: string, branchId: SessionBranchId) => void;
    onBranchFromMessage?: (messageId: string) => void;
    onForkFromMessage?: (messageId: string) => void;
}
export declare function ChatRowRenderer(props: ChatRowRendererProps): import("node_modules/@types/react").JSX.Element;
export {};
