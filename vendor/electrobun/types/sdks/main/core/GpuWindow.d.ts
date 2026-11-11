import { type Pointer } from "bun:ffi";
import { WGPUView } from "./WGPUView";
export type GpuWindowOptionsType = {
    trafficLightOffset?: {
        x: number;
        y: number;
    };
    activate?: boolean;
    title: string;
    frame: {
        x?: number;
        y?: number;
        width: number;
        height: number;
    };
    styleMask?: {};
    titleBarStyle: "hidden" | "hiddenInset" | "default";
    transparent: boolean;
};
export declare const GpuWindowMap: {
    [id: number]: GpuWindow;
};
export declare class GpuWindow {
    id: number;
    title: string;
    state: "creating" | "created";
    transparent: boolean;
    trafficLightOffset: {
        x: number;
        y: number;
    };
    frame: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    wgpuViewId: number;
    get ptr(): Pointer | null;
    constructor(options?: Partial<GpuWindowOptionsType>);
    init({ styleMask, titleBarStyle, transparent, activate }: Partial<GpuWindowOptionsType>, centered: boolean): void;
    get wgpuView(): WGPUView;
    static getById(id: number): GpuWindow;
    setTitle(title: string): void;
    close(): void;
    requestClose(): void;
    activate(): void;
    focus(): void;
    private visible;
    show(): void;
    showInactive(): void;
    hide(): void;
    isVisible(): boolean;
    minimize(): void;
    unminimize(): void;
    isMinimized(): boolean;
    maximize(): void;
    unmaximize(): void;
    isMaximized(): boolean;
    setFullScreen(fullScreen: boolean): void;
    isFullScreen(): boolean;
    setAlwaysOnTop(alwaysOnTop: boolean): void;
    isAlwaysOnTop(): boolean;
    setPosition(x: number, y: number): void;
    setWindowButtonPosition(x: number, y: number): void;
    center(): void;
    getWindowButtonPosition(): {
        x: number;
        y: number;
    };
    setSize(width: number, height: number): void;
    setFrame(x: number, y: number, width: number, height: number): void;
    getFrame(): {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    getPosition(): {
        x: number;
        y: number;
    };
    getSize(): {
        width: number;
        height: number;
    };
    on(name: string, handler: (event: unknown) => void): () => void;
    off(name: string, handler: (event: unknown) => void): void;
}
