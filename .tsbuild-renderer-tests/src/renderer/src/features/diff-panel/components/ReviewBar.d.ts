interface ReviewBarProps {
    readonly commentCount: number;
    readonly summary: string;
    readonly onSummaryChange: (summary: string) => void;
    readonly onSubmit: () => void;
    readonly onDiscard: () => void;
}
export declare function ReviewBar({ commentCount, summary, onSummaryChange, onSubmit, onDiscard, }: ReviewBarProps): import("node_modules/@types/react").JSX.Element | null;
export {};
