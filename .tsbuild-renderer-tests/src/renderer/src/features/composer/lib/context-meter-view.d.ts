import type { ContextUsageSnapshot } from '@shared/types/context-usage';
import type { ProviderInfo, SupportedModelId } from '@shared/types/llm';
interface ContextMeterValueInput {
    readonly snapshot: ContextUsageSnapshot | null;
    readonly fallbackContextWindow: number | null;
    readonly hasActiveSession: boolean;
    readonly failed: boolean;
}
export declare function buildContextUsageRequestKey(sessionId: string | null, model: SupportedModelId, sessionVersion: string): string;
export declare function findContextWindow(providerModels: readonly ProviderInfo[], modelRef: SupportedModelId): number | null;
export declare function buildContextMeterValue({ snapshot, fallbackContextWindow, hasActiveSession, failed, }: ContextMeterValueInput): {
    contextWindow: number | null;
    dashOffset: number;
    displayValue: string;
    strokeColor: string;
    title: string;
};
export {};
