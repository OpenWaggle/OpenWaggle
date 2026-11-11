declare function storeMenuData(data: any): string;
declare function getMenuData(id: string): any;
declare function clearMenuData(id: string): void;
declare function serializeMenuAction(action: string, data: any): string;
declare function deserializeMenuAction(encodedAction: string): {
    action: string;
    data: any;
};
import { CString, type Pointer } from "bun:ffi";
export declare const native: any;
export declare const hasFFI: boolean;
declare class PostMessageBridge {
    private requestId;
    private pendingRequests;
    private eventHandlers;
    constructor();
    sendAction(action: string, payload?: unknown): void;
    requestHost<T = unknown>(method: string, params?: unknown): Promise<T>;
    on(name: string, handler: (payload: unknown) => void): () => void;
    emit(name: string, payload: unknown): void;
    private handleMessage;
}
export declare const bridge: PostMessageBridge | null;
declare const _ffiImpl: {
    request: {
        createWindow: (params: {
            url: string | null;
            title: string;
            frame: {
                width: number;
                height: number;
                x: number;
                y: number;
            };
            styleMask: {
                Borderless: boolean;
                Titled: boolean;
                Closable: boolean;
                Miniaturizable: boolean;
                Resizable: boolean;
                UnifiedTitleAndToolbar: boolean;
                FullScreen: boolean;
                FullSizeContentView: boolean;
                UtilityWindow: boolean;
                DocModalWindow: boolean;
                NonactivatingPanel: boolean;
                HUDWindow: boolean;
            };
            titleBarStyle: string;
            transparent: boolean;
            hidden?: boolean;
            activate?: boolean;
            centered?: boolean;
            trafficLightOffset?: {
                x: number;
                y: number;
            };
        }) => number;
        getWindowPointer: (params: {
            winId: number;
        }) => Pointer | null;
        setTitle: (params: {
            winId: number;
            title: string;
        }) => void;
        closeWindow: (params: {
            winId: number;
        }) => void;
        requestWindowClose: (params: {
            winId: number;
        }) => void;
        showWindow: (params: {
            winId: number;
            activate?: boolean;
        }) => void;
        activateWindow: (params: {
            winId: number;
        }) => void;
        hideWindow: (params: {
            winId: number;
        }) => void;
        isWindowVisible: (params: {
            winId: number;
        }) => boolean;
        minimizeWindow: (params: {
            winId: number;
        }) => void;
        restoreWindow: (params: {
            winId: number;
        }) => void;
        isWindowMinimized: (params: {
            winId: number;
        }) => boolean;
        maximizeWindow: (params: {
            winId: number;
        }) => void;
        unmaximizeWindow: (params: {
            winId: number;
        }) => void;
        isWindowMaximized: (params: {
            winId: number;
        }) => boolean;
        setWindowFullScreen: (params: {
            winId: number;
            fullScreen: boolean;
        }) => void;
        isWindowFullScreen: (params: {
            winId: number;
        }) => boolean;
        setWindowAlwaysOnTop: (params: {
            winId: number;
            alwaysOnTop: boolean;
        }) => void;
        isWindowAlwaysOnTop: (params: {
            winId: number;
        }) => boolean;
        setWindowVisibleOnAllWorkspaces: (params: {
            winId: number;
            visibleOnAllWorkspaces: boolean;
        }) => void;
        isWindowVisibleOnAllWorkspaces: (params: {
            winId: number;
        }) => boolean;
        setWindowPosition: (params: {
            winId: number;
            x: number;
            y: number;
        }) => void;
        centerWindow: (params: {
            winId: number;
        }) => void;
        setWindowButtonPosition: (params: {
            winId: number;
            x: number;
            y: number;
        }) => void;
        getWindowButtonPosition: (params: {
            winId: number;
        }) => {
            x: number;
            y: number;
        };
        setWindowSize: (params: {
            winId: number;
            width: number;
            height: number;
        }) => void;
        setWindowFrame: (params: {
            winId: number;
            x: number;
            y: number;
            width: number;
            height: number;
        }) => void;
        getWindowFrame: (params: {
            winId: number;
        }) => {
            x: number;
            y: number;
            width: number;
            height: number;
        };
        getWindowContentOrigin: (params: {
            winId: number;
        }) => {
            x: number;
            y: number;
        };
        getWindowContentSize: (params: {
            winId: number;
        }) => {
            width: number;
            height: number;
        };
        createWebview: (params: {
            windowId: number;
            hostWebviewId: number | null;
            renderer: "cef" | "native";
            secretKey: string;
            url: string | null;
            partition: string | null;
            preload: string | null;
            viewsRoot: string | null;
            allowedProtocols: {
                views: boolean;
                appData: boolean;
            };
            frame: {
                x: number;
                y: number;
                width: number;
                height: number;
            };
            autoResize: boolean;
            navigationRules: string | null;
            sandbox: boolean;
            startTransparent: boolean;
            startPassthrough: boolean;
            spellCheck: boolean;
        }) => number;
        getWebviewPointer: (params: {
            id: number;
        }) => Pointer | null;
        resizeWebview: (params: {
            id: number;
            frame: {
                x: number;
                y: number;
                width: number;
                height: number;
            };
            masks?: string;
        }) => void;
        loadURLInWebView: (params: {
            id: number;
            url: string;
        }) => void;
        loadHTMLInWebView: (params: {
            id: number;
            html: string;
        }) => void;
        updatePreloadScriptToWebView: (params: {
            id: number;
            scriptIdentifier: string;
            script: string;
            allFrames: boolean;
        }) => void;
        webviewCanGoBack: (params: {
            id: number;
        }) => any;
        webviewCanGoForward: (params: {
            id: number;
        }) => any;
        webviewGoBack: (params: {
            id: number;
        }) => void;
        webviewGoForward: (params: {
            id: number;
        }) => void;
        webviewReload: (params: {
            id: number;
        }) => void;
        webviewRemove: (params: {
            id: number;
        }) => void;
        setWebviewHTMLContent: (params: {
            id: number;
            html: string;
        }) => void;
        webviewSetTransparent: (params: {
            id: number;
            transparent: boolean;
        }) => void;
        webviewSetPassthrough: (params: {
            id: number;
            passthrough: boolean;
        }) => void;
        webviewSetHidden: (params: {
            id: number;
            hidden: boolean;
        }) => void;
        webviewSetSpellCheck: (params: {
            id: number;
            enabled: boolean;
        }) => any;
        setWebviewNavigationRules: (params: {
            id: number;
            rulesJson: string;
        }) => void;
        webviewFindInPage: (params: {
            id: number;
            searchText: string;
            forward: boolean;
            matchCase: boolean;
        }) => void;
        webviewStopFind: (params: {
            id: number;
        }) => void;
        createWGPUView: (params: {
            windowId: number;
            frame: {
                x: number;
                y: number;
                width: number;
                height: number;
            };
            autoResize: boolean;
            startTransparent: boolean;
            startPassthrough: boolean;
        }) => number;
        getWGPUViewPointer: (params: {
            id: number;
        }) => Pointer | null;
        wgpuViewSetFrame: (params: {
            id: number;
            x: number;
            y: number;
            width: number;
            height: number;
        }) => void;
        resizeWGPUView: (params: {
            id: number;
            frame: {
                x: number;
                y: number;
                width: number;
                height: number;
            };
            masks?: string;
        }) => void;
        wgpuViewSetTransparent: (params: {
            id: number;
            transparent: boolean;
        }) => void;
        wgpuViewSetAlphaBlending: (params: {
            id: number;
            enabled: boolean;
        }) => void;
        wgpuViewSetPassthrough: (params: {
            id: number;
            passthrough: boolean;
        }) => void;
        wgpuViewSetHidden: (params: {
            id: number;
            hidden: boolean;
        }) => void;
        wgpuViewRemove: (params: {
            id: number;
        }) => void;
        wgpuViewGetNativeHandle: (params: {
            id: number;
        }) => Pointer | null;
        runWGPUViewTest: (params: {
            id: number;
        }) => void;
        evaluateJavascriptWithNoCompletion: (params: {
            id: number;
            js: string;
        }) => void;
        sendHostMessageToWebviewViaTransport: (params: {
            id: number;
            messageJson: string;
        }) => boolean;
        sendPreEncryptedHostMessageToWebviewViaTransport: (params: {
            id: number;
            encryptedPacketJson: string;
        }) => boolean;
        clearWebviewHostTransport: (params: {
            id: number;
        }) => void;
        webviewOpenDevTools: (params: {
            id: number;
        }) => void;
        webviewCloseDevTools: (params: {
            id: number;
        }) => void;
        webviewToggleDevTools: (params: {
            id: number;
        }) => void;
        webviewSetPageZoom: (params: {
            id: number;
            zoomLevel: number;
        }) => void;
        webviewGetPageZoom: (params: {
            id: number;
        }) => number;
        setExitOnLastWindowClosed: (params: {
            enabled: boolean;
        }) => void;
        quitGracefully: (params: {
            code: number;
            timeoutMs: number;
        }) => void;
        createTray: (params: {
            title: string;
            image: string;
            template: boolean;
            width: number;
            height: number;
        }) => number;
        showTray: (params: {
            id: number;
        }) => boolean;
        hideTray: (params: {
            id: number;
        }) => void;
        setTrayTitle: (params: {
            id: number;
            title: string;
        }) => void;
        setTrayImage: (params: {
            id: number;
            image: string;
        }) => void;
        setTrayMenu: (params: {
            id: number;
            menuConfig: string;
        }) => void;
        removeTray: (params: {
            id: number;
        }) => void;
        getTrayBounds: (params: {
            id: number;
        }) => Rectangle;
        setApplicationMenu: (params: {
            menuConfig: string;
        }) => void;
        showContextMenu: (params: {
            menuConfig: string;
        }) => void;
        moveToTrash: (params: {
            path: string;
        }) => boolean;
        showItemInFolder: (params: {
            path: string;
        }) => void;
        openExternal: (params: {
            url: string;
        }) => boolean;
        openPath: (params: {
            path: string;
        }) => boolean;
        showNotification: (params: {
            title: string;
            body?: string;
            subtitle?: string;
            silent?: boolean;
        }) => void;
        setDockIconVisible: (params: {
            visible: boolean;
        }) => void;
        isDockIconVisible: () => boolean;
        openFileDialog: (params: {
            startingFolder: string;
            allowedFileTypes: string;
            canChooseFiles: boolean;
            canChooseDirectory: boolean;
            allowsMultipleSelection: boolean;
        }) => string;
        showMessageBox: (params: {
            type?: string;
            title?: string;
            message?: string;
            detail?: string;
            buttons?: string[];
            defaultId?: number;
            cancelId?: number;
        }) => number;
        clipboardReadText: () => string | null;
        clipboardWriteText: (params: {
            text: string;
        }) => void;
        clipboardReadImage: () => Uint8Array | null;
        clipboardWriteImage: (params: {
            pngData: Uint8Array;
        }) => void;
        clipboardClear: () => void;
        clipboardAvailableFormats: () => string[];
    };
    internal: {
        storeMenuData: typeof storeMenuData;
        getMenuData: typeof getMenuData;
        clearMenuData: typeof clearMenuData;
        serializeMenuAction: typeof serializeMenuAction;
        deserializeMenuAction: typeof deserializeMenuAction;
    };
};
export declare const ffi: {
    request: typeof _ffiImpl.request;
    internal: {
        storeMenuData: typeof storeMenuData;
        getMenuData: typeof getMenuData;
        clearMenuData: typeof clearMenuData;
        serializeMenuAction: typeof serializeMenuAction;
        deserializeMenuAction: typeof deserializeMenuAction;
    };
};
export declare const WGPUBridge: {
    available: boolean;
    instanceCreateSurface: (instancePtr: Pointer, descriptorPtr: Pointer) => Pointer;
    surfaceConfigure: (surfacePtr: Pointer, configPtr: Pointer) => any;
    surfaceCapabilitiesFreeMembers: (capabilitiesPtr: Pointer) => any;
    surfaceGetCurrentTexture: (surfacePtr: Pointer, surfaceTexturePtr: Pointer) => any;
    surfacePresent: (surfacePtr: Pointer) => number;
    queueOnSubmittedWorkDone: (queuePtr: Pointer, callbackInfoPtr: Pointer) => bigint;
    bufferMapAsync: (bufferPtr: Pointer, mode: bigint, offset: bigint, size: bigint, callbackInfoPtr: Pointer) => bigint;
    instanceWaitAny: (instancePtr: Pointer, futureId: bigint, timeoutNs: bigint) => number;
    bufferReadSync: (instancePtr: Pointer, bufferPtr: Pointer, offset: bigint, size: bigint, timeoutNs: bigint, outSizePtr: Pointer) => Pointer;
    bufferReadSyncInto: (instancePtr: Pointer, bufferPtr: Pointer, offset: bigint, size: bigint, timeoutNs: bigint, dstPtr: Pointer) => number;
    bufferReadbackBegin: (bufferPtr: Pointer, offset: bigint, size: bigint, dstPtr: Pointer) => Pointer;
    bufferReadbackStatus: (jobPtr: Pointer) => number;
    bufferReadbackFree: (jobPtr: Pointer) => any;
    runTest: (viewId: number) => void;
    createAdapterDeviceMainThread: (instancePtr: Pointer, surfacePtr: Pointer, outAdapterDevicePtr: Pointer) => any;
    createSurfaceForView: (instancePtr: Pointer, viewPtr: Pointer) => Pointer | null;
    releaseSurfaceForView: (surfacePtr: Pointer) => boolean;
};
export declare const nativeText: {
    available(): boolean;
    measure(text: string, fontName: string, size: number): {
        w: number;
        h: number;
        ascent: number;
    };
    rasterize(text: string, fontName: string, size: number, scale: number): {
        width: number;
        height: number;
        data: Uint8Array;
    } | null;
};
/** Route native key events (with characters) as `wgpu-key-<viewId>`. */
export declare function enableWGPUKeyEvents(): boolean;
export declare function enableWindowTextEvents(): boolean;
/**
 * Route native pointer events (move/down/up/wheel/enter/exit) from all WGPU
 * views onto the event emitter as `wgpu-pointer-<viewId>`. Returns false when
 * the native wrapper does not support it (older binaries / other platforms).
 */
export declare function enableWGPUPointerEvents(): boolean;
export declare const GlobalShortcut: {
    /**
     * Register a global keyboard shortcut
     * @param accelerator - The shortcut string (e.g., "CommandOrControl+Shift+Space")
     * @param callback - Function to call when the shortcut is triggered
     * @returns true if registered successfully, false otherwise
     */
    register: (accelerator: string, callback: () => void) => boolean;
    unregister: (accelerator: string) => boolean;
    unregisterAll: () => void;
    isRegistered: (accelerator: string) => boolean;
};
export interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface Display {
    id: number;
    bounds: Rectangle;
    workArea: Rectangle;
    scaleFactor: number;
    isPrimary: boolean;
}
export interface Point {
    x: number;
    y: number;
}
export declare const Screen: {
    /**
     * Get the primary display
     * @returns Display object for the primary monitor
     */
    getPrimaryDisplay: () => Display;
    /**
     * Get all connected displays
     * @returns Array of Display objects
     */
    getAllDisplays: () => Display[];
    /**
     * Get the current cursor position in screen coordinates
     * @returns Point with x and y coordinates
     */
    getCursorScreenPoint: () => Point;
    /**
     * Capture a rectangular region of the desktop as row-major RGBA pixels.
     * Coordinates and dimensions use Electrobun's logical screen coordinate
     * system; fractional origins are aligned down to the logical pixel grid.
     * On Wayland, the first call starts the desktop's monitor-sharing portal and
     * returns null until the user approves a monitor and its first frame arrives.
     * Returns null when capture is unavailable or the rectangle is invalid.
     */
    captureRegion: (rectangle: Rectangle) => Uint8Array | null;
    /**
     * Get current mouse button bitmask (bit 0 = left, bit 1 = right, bit 2 = middle)
     */
    getMouseButtons: () => bigint;
};
export interface Cookie {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: "no_restriction" | "lax" | "strict";
    expirationDate?: number;
}
export interface CookieFilter {
    url?: string;
    name?: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    session?: boolean;
}
export type StorageType = "cookies" | "localStorage" | "sessionStorage" | "indexedDB" | "webSQL" | "cache" | "all";
declare class SessionCookies {
    private partitionId;
    constructor(partitionId: string);
    /**
     * Get cookies matching the filter criteria
     * @param filter - Optional filter to match cookies
     * @returns Array of matching cookies
     */
    get(filter?: CookieFilter): Cookie[];
    /**
     * Set a cookie
     * @param cookie - The cookie to set
     * @returns true if the cookie was set successfully
     */
    set(cookie: Cookie): boolean;
    /**
     * Remove a specific cookie
     * @param url - The URL associated with the cookie
     * @param name - The name of the cookie
     * @returns true if the cookie was removed successfully
     */
    remove(url: string, name: string): boolean;
    /**
     * Clear all cookies for this session
     */
    clear(): void;
}
declare class SessionInstance {
    readonly partition: string;
    readonly cookies: SessionCookies;
    constructor(partition: string);
    /**
     * Clear storage data for this session
     * @param types - Array of storage types to clear, or 'all' to clear everything
     */
    clearStorageData(types?: StorageType[] | "all"): void;
}
export declare const Session: {
    /**
     * Get or create a session for a given partition
     * @param partition - The partition identifier (e.g., "persist:myapp" or "ephemeral")
     * @returns Session instance for the partition
     */
    fromPartition: (partition: string) => SessionInstance;
    /**
     * Get the default session (persist:default partition)
     */
    readonly defaultSession: SessionInstance;
};
export declare function toCString(jsString: string, addNullTerminator?: boolean): CString;
type WebviewTagInitParams = {
    url: string | null;
    html: string | null;
    preload: string | null;
    renderer: "native" | "cef";
    partition: string | null;
    frame: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    hostWebviewId: number;
    windowId: number;
    navigationRules: string | null;
    sandbox: boolean;
    transparent: boolean;
    passthrough: boolean;
    spellCheck: boolean;
};
type WgpuTagInitParams = {
    windowId: number;
    frame: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    transparent: boolean;
    passthrough: boolean;
};
export declare const internalRpcHandlers: {
    request: {
        webviewTagInit: (params: WebviewTagInitParams) => number;
        wgpuTagInit: (params: WgpuTagInitParams) => number;
        webviewTagCanGoBack: (params: {
            id: number;
        }) => any;
        webviewTagCanGoForward: (params: {
            id: number;
        }) => any;
        webviewTagSetSpellCheck: (params: {
            id: number;
            enabled: boolean;
        }) => any;
        restoreWindowFocusAfterExternalDrop: (params: {
            windowId: number;
        }) => boolean;
    };
    message: {
        webviewTagResize: (params: {
            id: number;
            frame: {
                x: number;
                y: number;
                width: number;
                height: number;
            };
            masks: string;
        }) => void;
        wgpuTagResize: (params: {
            id: number;
            frame: {
                x: number;
                y: number;
                width: number;
                height: number;
            };
            masks: string;
        }) => void;
        uiTagMount: (params: {
            id: number;
            name: string;
        }) => void;
        webviewTagUpdateSrc: (params: {
            id: number;
            url: string;
        }) => void;
        webviewTagUpdateHtml: (params: {
            id: number;
            html: string;
        }) => void;
        webviewTagUpdatePreload: (params: {
            id: number;
            preload: string;
        }) => void;
        webviewTagGoBack: (params: {
            id: number;
        }) => void;
        webviewTagGoForward: (params: {
            id: number;
        }) => void;
        webviewTagReload: (params: {
            id: number;
        }) => void;
        webviewTagRemove: (params: {
            id: number;
        }) => void;
        startWindowMove: (params: {
            id: number;
        }) => void;
        stopWindowMove: (_params: unknown) => void;
        webviewTagSetTransparent: (params: {
            id: number;
            transparent: boolean;
        }) => void;
        wgpuTagSetTransparent: (params: {
            id: number;
            transparent: boolean;
        }) => void;
        webviewTagSetPassthrough: (params: {
            id: number;
            enablePassthrough: boolean;
        }) => void;
        wgpuTagSetPassthrough: (params: {
            id: number;
            passthrough: boolean;
        }) => void;
        webviewTagSetHidden: (params: {
            id: number;
            hidden: boolean;
        }) => void;
        wgpuTagSetHidden: (params: {
            id: number;
            hidden: boolean;
        }) => void;
        wgpuTagRemove: (params: {
            id: number;
        }) => void;
        wgpuTagRunTest: (params: {
            id: number;
        }) => void;
        webviewTagSetNavigationRules: (params: {
            id: number;
            rules: string[];
        }) => void;
        webviewTagFindInPage: (params: {
            id: number;
            searchText: string;
            forward: boolean;
            matchCase: boolean;
        }) => void;
        webviewTagStopFind: (params: {
            id: number;
        }) => void;
        webviewTagOpenDevTools: (params: {
            id: number;
        }) => void;
        webviewTagCloseDevTools: (params: {
            id: number;
        }) => void;
        webviewTagToggleDevTools: (params: {
            id: number;
        }) => void;
        webviewTagExecuteJavascript: (params: {
            id: number;
            js: string;
        }) => void;
        webviewEvent: (params: unknown) => void;
    };
};
export type MenuItemConfig = {
    type: "divider" | "separator";
} | {
    type: "normal";
    label: string;
    tooltip?: string;
    action?: string;
    data?: any;
    submenu?: Array<MenuItemConfig>;
    enabled?: boolean;
    checked?: boolean;
    hidden?: boolean;
};
export type ApplicationMenuItemConfig = {
    type: "divider" | "separator";
} | {
    type?: "normal";
    label: string;
    tooltip?: string;
    action?: string;
    data?: any;
    submenu?: Array<ApplicationMenuItemConfig>;
    enabled?: boolean;
    checked?: boolean;
    hidden?: boolean;
    accelerator?: string;
} | {
    type?: "normal";
    label?: string;
    tooltip?: string;
    role?: string;
    data?: any;
    submenu?: Array<ApplicationMenuItemConfig>;
    enabled?: boolean;
    checked?: boolean;
    hidden?: boolean;
    accelerator?: string;
};
export {};
