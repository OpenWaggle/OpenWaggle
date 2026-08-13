import type { AgentErrorInfo } from '@shared/types/errors';
import type { UseFeedbackReturn } from '@/features/feedback/hooks/useFeedback';
interface FeedbackModalBodyProps {
    readonly fb: UseFeedbackReturn;
    readonly ghReady: boolean | undefined;
    readonly errorContext: AgentErrorInfo | null;
    readonly lastUserMessage: string | null;
}
export declare function FeedbackModalBody({ fb, ghReady, errorContext, lastUserMessage, }: FeedbackModalBodyProps): import("node_modules/@types/react").JSX.Element;
interface FeedbackModalFooterProps {
    readonly fb: UseFeedbackReturn;
    readonly canSubmit: boolean;
    readonly ghReady: boolean | undefined;
    readonly onClose: () => void;
}
export declare function FeedbackModalFooter({ fb, canSubmit, ghReady, onClose }: FeedbackModalFooterProps): import("node_modules/@types/react").JSX.Element;
export {};
