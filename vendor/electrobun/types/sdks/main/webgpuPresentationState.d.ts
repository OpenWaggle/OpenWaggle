/**
 * Tracks which configured surface belongs to which queue and whether that
 * surface has an acquired texture waiting to be presented.
 *
 * Keeping this state keyed by surface prevents one window's submit,
 * unconfigure, or teardown from consuming another window's pending frame.
 */
export declare class WebgpuPresentationState<TQueue extends object, TSurface extends object> {
    private readonly queueBySurface;
    private readonly surfacesByQueue;
    private readonly pendingSurfaces;
    attach(queue: TQueue, surface: TSurface): void;
    markPending(surface: TSurface): void;
    isPending(surface: TSurface): boolean;
    takePending(surface: TSurface): boolean;
    presentPending(queue: TQueue, present: (surface: TSurface) => void): number;
    presentPendingSurface(queue: TQueue, surface: TSurface, present: (surface: TSurface) => void): boolean;
    detachSurface(surface: TSurface): void;
    detachQueue(queue: TQueue): TSurface[];
}
