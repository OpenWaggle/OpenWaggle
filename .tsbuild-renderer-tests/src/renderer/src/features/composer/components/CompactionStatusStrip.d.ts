export type CompactionStatusState = {
    readonly type: 'compacting';
    readonly reason: 'manual' | 'threshold' | 'overflow';
} | {
    readonly type: 'retrying';
    readonly attempt: number;
    readonly maxAttempts: number;
    readonly delayMs: number;
    readonly errorMessage: string;
};
interface CompactionStatusStripProps {
    readonly state: CompactionStatusState;
    readonly onCancel: () => void;
}
export declare function CompactionStatusStrip({ state, onCancel }: CompactionStatusStripProps): import("node_modules/@types/react").JSX.Element;
export {};
