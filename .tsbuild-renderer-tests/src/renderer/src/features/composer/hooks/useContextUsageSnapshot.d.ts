import type { SessionId } from '@shared/types/brand';
import type { ContextUsageSnapshot } from '@shared/types/context-usage';
import type { SupportedModelId } from '@shared/types/llm';
interface UseContextUsageSnapshotInput {
    readonly activeSessionId: SessionId | null;
    readonly selectedModel: SupportedModelId;
    readonly requestKey: string;
}
export declare function useContextUsageSnapshot({ activeSessionId, selectedModel, requestKey, }: UseContextUsageSnapshotInput): {
    snapshot: ContextUsageSnapshot | null;
    failed: boolean;
};
export {};
