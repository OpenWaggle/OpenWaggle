interface BranchSummaryCardProps {
    readonly id: string;
    readonly summary: string;
    readonly onBranchFromMessage?: (messageId: string) => void;
}
export declare function BranchSummaryCard({ id, summary, onBranchFromMessage }: BranchSummaryCardProps): import("node_modules/@types/react").JSX.Element;
export {};
