import { type Pointer } from "bun:ffi";
export type WGPUViewOptions = {
    frame: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    autoResize: boolean;
    windowId: number;
    startTransparent: boolean;
    startPassthrough: boolean;
};
export declare class WGPUView {
    id: number;
    windowId: number;
    autoResize: boolean;
    frame: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    startTransparent: boolean;
    startPassthrough: boolean;
    isRemoved: boolean;
    private beforeRemoveHooks;
    get ptr(): Pointer | null;
    constructor(options?: Partial<WGPUViewOptions>);
    init(): number;
    setFrame(x: number, y: number, width: number, height: number): void;
    setTransparent(transparent: boolean): void;
    /**
     * Enable alpha compositing: the surface's alpha channel blends against
     * whatever is behind the view (unlike setTransparent, which hides the
     * layer entirely). Required for transparent GPU-rendered windows.
     */
    setAlphaBlending(enabled: boolean): void;
    setPassthrough(passthrough: boolean): void;
    setHidden(hidden: boolean): void;
    on(name: "frame-updated", handler: (event: unknown) => void): void;
    /**
     * Run teardown synchronously while the native view and WebGPU context still
     * exist. The returned callback removes this subscription.
     */
    onBeforeRemove(handler: () => void): () => void;
    remove(): void;
    getNativeHandle(): any;
    static getById(id: number): WGPUView;
    static adoptExisting(id: number, options?: Partial<WGPUViewOptions>): WGPUView | undefined;
    static getAll(): WGPUView[];
}
