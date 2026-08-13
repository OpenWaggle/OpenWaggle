import type { SessionId } from '@shared/types/brand';
export interface StreamingPhase {
    label: string;
    elapsedMs: number;
}
export interface CompletedPhase {
    label: string;
    durationMs: number;
}
export interface StreamingPhaseState {
    current: StreamingPhase | null;
    completed: readonly CompletedPhase[];
    totalElapsedMs: number;
}
export declare function formatElapsed(ms: number): string;
export interface StreamingPhaseHandle extends StreamingPhaseState {
    /** Call synchronously before starting a new user interaction (IPC send).
     *  Must be invoked in the same sync block as the send so the reset flag
     *  is visible to the IPC phase handler before any events arrive. */
    reset: () => void;
}
/**
 * Tracks agent phase transitions and accumulates completed phase durations.
 *
 * Uses client-side wall-clock timestamps so that setup time, IPC overhead,
 * and gaps between Pi runtime turns are fully captured. The server-provided
 * `startedAt` is only used to detect same-phase dedup; all duration math
 * uses `Date.now()` on the client.
 *
 * Between-run gaps (IPC reconnect, runtime setup, model latency) are
 * attributed to the first phase of the next run (typically "Thinking"),
 * giving an accurate picture of where time was spent from the user's
 * perspective.
 */
export declare function useStreamingPhase(sessionId: SessionId | null): StreamingPhaseHandle;
