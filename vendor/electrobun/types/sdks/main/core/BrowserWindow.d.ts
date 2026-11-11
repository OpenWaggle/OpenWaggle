import { BrowserView } from "./BrowserView";
import { type Pointer } from "bun:ffi";
import { type RPCWithTransport } from "../../../shared/rpc.js";
export type WindowOptionsType<T = undefined> = {
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
    url: string | null;
    html: string | null;
    preload: string | null;
    viewsRoot: string | null;
    allowedProtocols: {
        views?: boolean;
        appData?: boolean;
    };
    renderer: "native" | "cef";
    rpc?: T;
    styleMask?: {};
    titleBarStyle: "hidden" | "hiddenInset" | "default";
    transparent: boolean;
    passthrough: boolean;
    spellCheck: boolean;
    hidden?: boolean;
    navigationRules: string | null;
    sandbox: boolean;
};
export declare const BrowserWindowMap: {
    [id: number]: BrowserWindow<RPCWithTransport>;
};
export declare class BrowserWindow<T extends RPCWithTransport = RPCWithTransport> {
    id: number;
    title: string;
    state: "creating" | "created";
    url: string | null;
    html: string | null;
    preload: string | null;
    viewsRoot: string | null;
    allowedProtocols: {
        views: boolean;
        appData: boolean;
    };
    renderer: "native" | "cef";
    transparent: boolean;
    passthrough: boolean;
    spellCheck: boolean;
    hidden: boolean;
    trafficLightOffset: {
        x: number;
        y: number;
    };
    navigationRules: string | null;
    sandbox: boolean;
    frame: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    webviewId: number;
    get ptr(): Pointer | null;
    constructor(options?: Partial<WindowOptionsType<T>>);
    init({ rpc, styleMask, titleBarStyle, transparent, hidden, activate, }: Partial<WindowOptionsType<T>>, centered: boolean): void;
    get webview(): BrowserView<T>;
    static getById(id: number): BrowserWindow<RPCWithTransport>;
    setTitle(title: string): void;
    /**
     * Toggles macOS system spell checking for this window's native WKWebView.
     * Returns false when the current renderer/platform does not support it.
     */
    setSpellCheck(enabled: boolean): boolean;
    close(): void;
    requestClose(): void;
    activate(): void;
    focus(): void;
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
    setVisibleOnAllWorkspaces(visibleOnAllWorkspaces: boolean): void;
    isVisibleOnAllWorkspaces(): boolean;
    setPosition(x: number, y: number): void;
    center(): void;
    setWindowButtonPosition(x: number, y: number): void;
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
    /**
     * Set the page zoom level for the window's webview (WebKit only).
     * @param zoomLevel - The zoom level (1.0 = 100%, 1.5 = 150%, etc.)
     */
    setPageZoom(zoomLevel: number): void;
    /**
     * Get the current page zoom level for the window's webview.
     * @returns The current zoom level (1.0 = 100%)
     */
    getPageZoom(): number;
    on(name: string, handler: (event: unknown) => void): void;
}
