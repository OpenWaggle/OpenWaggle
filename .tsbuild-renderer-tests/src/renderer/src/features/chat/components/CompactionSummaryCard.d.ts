interface CompactionSummaryCardProps {
    readonly id: string;
    readonly summary: string;
    readonly tokensBefore: number;
    readonly onBranchFromMessage?: (messageId: string) => void;
}
export declare function CompactionSummaryCard({ id, summary, tokensBefore, onBranchFromMessage, }: CompactionSummaryCardProps): import("node_modules/@types/react").JSX.Element;
export {};
