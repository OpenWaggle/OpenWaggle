import type { UIMessage } from '@shared/types/chat-ui';
interface UserMessageBubbleProps {
    message: UIMessage;
    onBranchFromMessage?: (messageId: string) => void;
    onForkFromMessage?: (messageId: string) => void;
}
export declare function UserMessageBubble({ message, onBranchFromMessage, onForkFromMessage, }: UserMessageBubbleProps): import("node_modules/@types/react").JSX.Element;
export {};
