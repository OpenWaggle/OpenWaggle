import type { SessionId } from '@shared/types/brand';
import { type SessionStatus } from '@shared/types/session-status';
interface SessionStatusState {
    statuses: Map<SessionId, SessionStatus>;
    /** When a terminal status (completed/error) was recorded */
    completedAt: Map<SessionId, number>;
    /** When the user last visited (navigated to) a session */
    lastVisitedAt: Map<SessionId, number>;
    setStatus: (id: SessionId, status: SessionStatus) => void;
    clearStatus: (id: SessionId) => void;
    getStatus: (id: SessionId) => SessionStatus;
    markVisited: (id: SessionId) => void;
    markUnread: (id: SessionId) => void;
}
export declare const useSessionStatusStore: import("node_modules/zustand/esm/react.mjs").UseBoundStore<import("node_modules/zustand/esm/vanilla.mjs").StoreApi<SessionStatusState>>;
export {};
