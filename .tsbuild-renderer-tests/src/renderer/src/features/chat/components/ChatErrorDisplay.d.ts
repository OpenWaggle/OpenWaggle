interface ChatErrorDisplayProps {
    error: Error;
    lastUserMessage: string | null;
    dismissedError: string | null;
    sessionId: string | null;
    onDismiss: (message: string) => void;
    onOpenSettings?: () => void;
    onRetry?: (content: string) => void;
}
export declare function ChatErrorDisplay({ error, lastUserMessage, dismissedError, sessionId, onDismiss, onOpenSettings, onRetry, }: ChatErrorDisplayProps): import("node_modules/@types/react").JSX.Element | null;
export {};
