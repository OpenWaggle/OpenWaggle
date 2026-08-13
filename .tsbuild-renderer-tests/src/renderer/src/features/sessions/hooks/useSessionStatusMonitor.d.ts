/**
 * Subscribes to agent lifecycle events and maintains per-session status
 * in the session-status store. Mounted once at workspace level.
 *
 * When a terminal status arrives for the currently active session,
 * it is immediately marked as visited so the icon doesn't flash.
 */
export declare function useSessionStatusMonitor(): void;
