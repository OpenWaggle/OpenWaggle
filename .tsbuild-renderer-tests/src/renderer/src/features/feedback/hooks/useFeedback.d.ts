import type { AgentErrorInfo } from '@shared/types/errors';
import type { FeedbackCategory, GhCliStatus } from '@shared/types/feedback';
export interface UseFeedbackReturn {
    ghStatus: GhCliStatus | null;
    submitting: boolean;
    error: string | null;
    cooldownActive: boolean;
    title: string;
    setTitle: (value: string) => void;
    description: string;
    setDescription: (value: string) => void;
    category: FeedbackCategory;
    setCategory: (value: FeedbackCategory) => void;
    includeSystemInfo: boolean;
    setIncludeSystemInfo: (value: boolean) => void;
    includeLogs: boolean;
    setIncludeLogs: (value: boolean) => void;
    includeErrorContext: boolean;
    setIncludeErrorContext: (value: boolean) => void;
    includeLastMessage: boolean;
    setIncludeLastMessage: (value: boolean) => void;
    includeModelInfo: boolean;
    setIncludeModelInfo: (value: boolean) => void;
    submit: () => Promise<void>;
    copyAndOpen: () => Promise<void>;
}
export declare function useFeedback(errorContext: AgentErrorInfo | null, lastUserMessage: string | null, activeModel: string | null, activeProvider: string | null): UseFeedbackReturn;
