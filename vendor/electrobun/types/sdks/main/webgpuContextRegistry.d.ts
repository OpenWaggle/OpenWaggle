export interface WebgpuContextEntry<T> {
    instance: number;
    surface: number;
    context: T;
    teardown(): void;
}
/** Owns context entries and their "last created" fallback as one lifecycle. */
export declare class WebgpuContextRegistry<T> {
    private readonly contexts;
    lastCreatedContext: T | null;
    get size(): number;
    get(key: number): WebgpuContextEntry<T> | undefined;
    set(key: number, entry: WebgpuContextEntry<T>): void;
    release(key: number): boolean;
}
export interface WebgpuNativeCreateOps {
    createInstance(): number;
    createSurface(instance: number): number;
    unconfigureSurface(surface: number): void;
    releaseSurface(surface: number): void;
    releaseInstance(instance: number): void;
}
/**
 * Creates the instance/surface pair and rolls both handles back when surface
 * creation or any pre-registration initialization fails.
 */
export declare function createNativeWebgpuContext<T>(ops: WebgpuNativeCreateOps, initialize: (handles: {
    instance: number;
    surface: number;
}) => T): T;
export interface WebgpuNativeReleaseOps {
    unconfigureSurface(surface: number): void;
    releaseSurface(surface: number): void;
    releaseInstance(instance: number): void;
}
/** Release every native handle even if an earlier teardown operation fails. */
export declare function releaseNativeWebgpuContext(entry: {
    instance: number;
    surface: number;
}, ops: WebgpuNativeReleaseOps): void;
export declare function registerWebgpuContextRelease(key: number, release: () => void): void;
export declare function releaseWebgpuContext(key: number): boolean;
