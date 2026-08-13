import type { SessionId } from '@shared/types/brand';
import type { UIMessage } from '@shared/types/chat-ui';
import type { AgentTransportEvent } from '@shared/types/stream';
interface ActiveRunRenderSnapshot {
    readonly messages: readonly UIMessage[];
    readonly updatedAt: number;
}
interface BackgroundRunState {
    activeRunIds: Set<SessionId>;
    renderSnapshotsBySessionId: Map<SessionId, ActiveRunRenderSnapshot>;
    addActiveRun: (id: SessionId) => void;
    removeActiveRun: (id: SessionId) => void;
    hasActiveRun: (id: SessionId) => boolean;
    getRunRenderSnapshot: (id: SessionId) => ActiveRunRenderSnapshot | null;
    setRunRenderMessages: (id: SessionId, messages: readonly UIMessage[]) => void;
    applyRunRenderEvent: (id: SessionId, event: AgentTransportEvent) => void;
    clearRunRenderSnapshot: (id: SessionId) => void;
    initialize: () => Promise<void>;
}
export declare const useBackgroundRunStore: import("node_modules/zustand/esm/react.mjs").UseBoundStore<import("node_modules/zustand/esm/vanilla.mjs").StoreApi<BackgroundRunState>>;
export {};
