import { SupportedModelId } from '@shared/types/brand';
import type { WaggleMessageMetadata } from '@shared/types/waggle';
export declare const ARCHITECT_MODEL: SupportedModelId;
export declare const REVIEWER_MODEL: SupportedModelId;
export declare function itemAt<TItem>(items: readonly TItem[], index: number): TItem;
export declare function makeConfig(): {
    mode: "sequential";
    agents: [{
        label: string;
        model: SupportedModelId;
        roleDescription: string;
        color: "blue";
    }, {
        label: string;
        model: SupportedModelId;
        roleDescription: string;
        color: "amber";
    }];
    stop: {
        primary: "consensus";
        maxTurnsSafety: number;
    };
};
export declare function makeConsensusResult(reached: boolean): {
    reached: boolean;
    confidence: number;
    reason: string;
    signals: {
        type: "explicit-agreement";
        confidence: number;
        reason: string;
    }[];
};
export declare function makeFileConflict(path: string): {
    path: string;
    previousAgent: string;
    currentAgent: string;
    turnNumber: number;
};
export declare function makeMessageMetadata(overrides?: Partial<WaggleMessageMetadata>): {
    agentIndex: number;
    agentLabel: string;
    agentColor: import("@shared/types/waggle").WaggleAgentColor;
    agentModel?: SupportedModelId;
    turnNumber: number;
    sessionId?: string;
};
