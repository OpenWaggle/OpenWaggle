import type { JsonObject } from '@shared/types/json';
import { type ToolCallResultPayload, type UnifiedDiffData } from '@/features/chat/lib/tool-call-block';
interface ToolCallBlockProps {
    name: string;
    args: string;
    state: string;
    result?: ToolCallResultPayload;
    isStreaming?: boolean;
    onBranchFromMessage?: (messageId: string) => void;
}
export interface ToolCallViewModel {
    readonly actionText: string;
    readonly awaitingResult: boolean;
    readonly branchSourceMessageId: string | undefined;
    readonly command: string | null;
    readonly diff: UnifiedDiffData | null;
    readonly failedOutputPreview: string;
    readonly hasConcreteResult: boolean;
    readonly inlineDiffVisible: boolean;
    readonly isError: boolean;
    readonly isRunning: boolean;
    readonly liveOutputPreview: string;
    readonly parsedArgs: JsonObject;
    readonly path: string | null;
    readonly resultError: string | null;
    readonly resultText: string;
}
export declare function ToolCallBlock({ name, args, state, result, isStreaming, onBranchFromMessage, }: ToolCallBlockProps): import("node_modules/@types/react").JSX.Element;
export {};
