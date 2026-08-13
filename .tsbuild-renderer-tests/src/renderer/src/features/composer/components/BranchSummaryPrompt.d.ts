interface BranchSummaryPromptProps {
    readonly onNoSummary: () => void;
    readonly onSummarize: () => void;
    readonly onCustomSummary: () => void;
    readonly onCancel: () => void;
}
export declare function BranchSummaryPrompt({ onNoSummary, onSummarize, onCustomSummary, onCancel, }: BranchSummaryPromptProps): import("node_modules/@types/react").JSX.Element | null;
export {};
