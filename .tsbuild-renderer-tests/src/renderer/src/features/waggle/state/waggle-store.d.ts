import type { SessionId } from '@shared/types/brand';
import { type WaggleCollaborationStatus, type WaggleConfig, type WaggleConsensusCheckResult, type WaggleFileConflictWarning, type WaggleMessageMetadata, type WaggleTurnEvent } from '@shared/types/waggle';
interface WaggleState {
    activeCollaborationId: SessionId | null;
    /** Tracks which session the idle config targets (before startCollaboration). */
    configSessionId: SessionId | null;
    activeConfig: WaggleConfig | null;
    status: WaggleCollaborationStatus;
    currentTurn: number;
    currentAgentIndex: number;
    currentAgentLabel: string;
    initialTurnMeta: WaggleMessageMetadata | null;
    completedTurnMeta: WaggleMessageMetadata[];
    liveMessageMetadata: Record<string, WaggleMessageMetadata>;
    fileConflicts: WaggleFileConflictWarning[];
    lastConsensusResult: WaggleConsensusCheckResult | null;
    completionReason: string | null;
    setConfig: (config: WaggleConfig, sessionId: SessionId | null) => void;
    clearConfig: () => void;
    startCollaboration: (sessionId: SessionId, config: WaggleConfig) => void;
    handleTurnEvent: (event: WaggleTurnEvent) => void;
    trackMessageMetadata: (messageId: string, meta: WaggleMessageMetadata) => void;
    stopCollaboration: () => void;
    reset: () => void;
}
export declare const useWaggleStore: import("node_modules/zustand/esm/react.mjs").UseBoundStore<import("node_modules/zustand/esm/vanilla.mjs").StoreApi<WaggleState>>;
export {};
