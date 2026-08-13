import type { CompletedPhase } from '@/features/chat/hooks/useStreamingPhase';
interface RunSummaryProps {
    phases: readonly CompletedPhase[];
    totalMs: number;
}
export declare function RunSummary({ phases, totalMs }: RunSummaryProps): import("node_modules/@types/react").JSX.Element;
export {};
