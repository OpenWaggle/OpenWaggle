import { type ElectrobunRPCSchema, type ElectrobunRPCConfig, type RPCWithTransport } from "../../../shared/rpc.js";
import { type Pointer } from "bun:ffi";
type QueuedWebviewMessage = {
    message: string;
    markSent: () => void;
    enqueuedAt: number;
    bytes: number;
};
export type BrowserViewOptions<T = undefined> = {
    url: string | null;
    html: string | null;
    preload: string | null;
    viewsRoot: string | null;
    allowedProtocols: {
        views?: boolean;
        appData?: boolean;
    };
    renderer: "native" | "cef";
    partition: string | null;
    frame: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    rpc: T;
    hostWebviewId: number;
    autoResize: boolean;
    windowId: number;
    navigationRules: string | null;
    sandbox: boolean;
    startTransparent: boolean;
    startPassthrough: boolean;
    spellCheck: boolean;
};
export type BrowserViewCreatedHandler = (view: BrowserView) => void;
export declare class BrowserView<T extends RPCWithTransport = RPCWithTransport> {
    id: number;
    hostWebviewId?: number;
    windowId: number;
    renderer: "cef" | "native";
    url: string | null;
    html: string | null;
    preload: string | null;
    viewsRoot: string | null;
    allowedProtocols: {
        views: boolean;
        appData: boolean;
    };
    partition: string | null;
    autoResize: boolean;
    frame: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    secretKey: Uint8Array;
    rpc?: T;
    rpcHandler?: (msg: unknown) => void;
    hostMessageSendQueue: QueuedWebviewMessage[];
    hostResponseSendQueue: QueuedWebviewMessage[];
    flushingHostMessageSendQueue: boolean;
    private hostMessageQueuedBytes;
    private hostMessageEnqueued;
    private hostMessageDrained;
    private hostMessagePeakQueuedBytes;
    private hostMessagePeakQueuedCount;
    navigationRules: string | null;
    sandbox: boolean;
    startTransparent: boolean;
    startPassthrough: boolean;
    spellCheck: boolean;
    isRemoved: boolean;
    get ptr(): Pointer | null;
    constructor(options?: Partial<BrowserViewOptions<T>>);
    init(): number;
    initializeRpcTransport(): void;
    sendHostMessageToWebviewViaExecute(jsonMessage: unknown): void;
    private sendHostMessagesToWebviewViaExecute;
    sendInternalHostMessageViaExecute(jsonMessage: unknown): void;
    executeJavascript(js: string): void;
    loadURL(url: string): void;
    loadHTML(html: string): void;
    setNavigationRules(rules: string[]): void;
    /**
     * Toggles macOS system spell checking for native WKWebView content.
     * Returns false when the current renderer/platform does not support it.
     */
    setSpellCheck(enabled: boolean): boolean;
    findInPage(searchText: string, options?: {
        forward?: boolean;
        matchCase?: boolean;
    }): void;
    stopFindInPage(): void;
    openDevTools(): void;
    closeDevTools(): void;
    toggleDevTools(): void;
    /**
     * Set the page zoom level (WebKit only, similar to browser zoom).
     * @param zoomLevel - The zoom level (1.0 = 100%, 1.5 = 150%, etc.)
     */
    setPageZoom(zoomLevel: number): void;
    /**
     * Get the current page zoom level.
     * @returns The current zoom level (1.0 = 100%)
     */
    getPageZoom(): number;
    on(name: "will-navigate" | "did-navigate" | "did-navigate-in-page" | "did-commit-navigation" | "dom-ready" | "download-started" | "download-progress" | "download-completed" | "download-failed", handler: (event: unknown) => void): void;
    createTransport: () => {
        send(message: any): Promise<void>;
        registerHandler(handler: (msg: unknown) => void): void;
    };
    queueHostMessageToWebview(message: unknown): Promise<void>;
    private hasQueuedHostMessages;
    private takeQueuedHostMessageBatch;
    private scheduleHostMessageFlush;
    private sendQueuedHostMessageBatch;
    flushHostMessageSendQueue(): Promise<void>;
    /** Host queue only; bytes are serialized UTF-8, not retained heap size.
     * Drained means handed to the native transport, not rendered by the WebView. */
    getHostMessageQueueStats(): {
        queuedMessages: number;
        queuedBytes: number;
        oldestMessageAgeMs: number;
        enqueuedMessages: number;
        drainedMessages: number;
        peakQueuedMessages: number;
        peakQueuedBytes: number;
    };
    private resolveQueuedHostMessages;
    remove(): void;
    static getById(id: number): BrowserView<any>;
    static ensureWrapped<T extends RPCWithTransport = RPCWithTransport>(id: number, options?: Partial<BrowserViewOptions<T>>): BrowserView<T> | undefined;
    static adoptExisting<T extends RPCWithTransport = RPCWithTransport>(id: number, options?: Partial<BrowserViewOptions<T>>): BrowserView<T> | undefined;
    static getAll(): BrowserView<any>[];
    /**
     * Listen for BrowserViews created by <electrobun-webview> tags.
     * The handler runs before the tag's initialization request resolves.
     */
    static on(name: "created", handler: BrowserViewCreatedHandler): () => void;
    static off(_name: "created", handler: BrowserViewCreatedHandler): void;
    static defineRPC<Schema extends ElectrobunRPCSchema>(config: ElectrobunRPCConfig<Schema, "bun">): {
        setTransport: (newTransport: import("../../../shared/rpc.js").RPCTransport) => void;
        setRequestHandler: (h: import("../../../shared/rpc.js").RPCRequestHandler<Schema["bun"]["requests"]>) => void;
        request: (<M extends keyof Schema["webview"]["requests"]>(method: M, ...args: "params" extends keyof Schema["webview"]["requests"][M] ? undefined extends Schema["webview"]["requests"][M][keyof Schema["webview"]["requests"][M] & "params"] ? [params?: Schema["webview"]["requests"][M][keyof Schema["webview"]["requests"][M] & "params"] | undefined, options?: import("../index.js").RPCRequestOptions | undefined] : [params: Schema["webview"]["requests"][M][keyof Schema["webview"]["requests"][M] & "params"], options?: import("../index.js").RPCRequestOptions | undefined] : [params?: undefined, options?: import("../index.js").RPCRequestOptions | undefined]) => Promise<"response" extends keyof Schema["webview"]["requests"][M] ? Schema["webview"]["requests"][M][keyof Schema["webview"]["requests"][M] & "response"] : void>) & (Schema["webview"]["requests"] extends infer T extends {
            [key: string]: {
                params: unknown;
                response: unknown;
            };
        } ? { [K in keyof T]: (...args: "params" extends keyof T[K] ? undefined extends T[K][keyof T[K] & "params"] ? [params?: T[K][keyof T[K] & "params"] | undefined, options?: import("../index.js").RPCRequestOptions | undefined] : [params: T[K][keyof T[K] & "params"], options?: import("../index.js").RPCRequestOptions | undefined] : [params?: undefined, options?: import("../index.js").RPCRequestOptions | undefined]) => Promise<"response" extends keyof T[K] ? T[K][keyof T[K] & "response"] : void>; } : never);
        requestProxy: Schema["webview"]["requests"] extends infer T extends {
            [key: string]: {
                params: unknown;
                response: unknown;
            };
        } ? { [K in keyof T]: (...args: "params" extends keyof T[K] ? undefined extends T[K][keyof T[K] & "params"] ? [params?: T[K][keyof T[K] & "params"] | undefined, options?: import("../index.js").RPCRequestOptions | undefined] : [params: T[K][keyof T[K] & "params"], options?: import("../index.js").RPCRequestOptions | undefined] : [params?: undefined, options?: import("../index.js").RPCRequestOptions | undefined]) => Promise<"response" extends keyof T[K] ? T[K][keyof T[K] & "response"] : void>; } : never;
        send: (<M extends keyof Schema["webview"]["messages"]>(message: M, ...args: void extends Schema["webview"]["messages"][M] ? [] : undefined extends Schema["webview"]["messages"][M] ? [payload?: Schema["webview"]["messages"][M] | undefined] : [payload: Schema["webview"]["messages"][M]]) => void | PromiseLike<void>) & (Schema["webview"]["messages"] extends infer T_1 extends {} ? { [K in keyof T_1]-?: (...args: void extends T_1[K] ? [] : undefined extends T_1[K] ? [payload?: T_1[K] | undefined] : [payload: T_1[K]]) => void | PromiseLike<void>; } : never);
        sendProxy: Schema["webview"]["messages"] extends infer T_1 extends {} ? { [K in keyof T_1]-?: (...args: void extends T_1[K] ? [] : undefined extends T_1[K] ? [payload?: T_1[K] | undefined] : [payload: T_1[K]]) => void | PromiseLike<void>; } : never;
        addMessageListener: {
            (message: "*", listener: import("../../../shared/rpc.js").WildcardRPCMessageHandlerFn<Schema["bun"]["messages"]>): void;
            <M extends keyof Schema["bun"]["messages"]>(message: M, listener: import("../../../shared/rpc.js").RPCMessageHandlerFn<Schema["bun"]["messages"], M>): void;
        };
        removeMessageListener: {
            (message: "*", listener: import("../../../shared/rpc.js").WildcardRPCMessageHandlerFn<Schema["bun"]["messages"]>): void;
            <M extends keyof Schema["bun"]["messages"]>(message: M, listener: import("../../../shared/rpc.js").RPCMessageHandlerFn<Schema["bun"]["messages"], M>): void;
        };
        proxy: {
            send: Schema["webview"]["messages"] extends infer T_1 extends {} ? { [K in keyof T_1]-?: (...args: void extends T_1[K] ? [] : undefined extends T_1[K] ? [payload?: T_1[K] | undefined] : [payload: T_1[K]]) => void | PromiseLike<void>; } : never;
            request: Schema["webview"]["requests"] extends infer T extends {
                [key: string]: {
                    params: unknown;
                    response: unknown;
                };
            } ? { [K in keyof T]: (...args: "params" extends keyof T[K] ? undefined extends T[K][keyof T[K] & "params"] ? [params?: T[K][keyof T[K] & "params"] | undefined, options?: import("../index.js").RPCRequestOptions | undefined] : [params: T[K][keyof T[K] & "params"], options?: import("../index.js").RPCRequestOptions | undefined] : [params?: undefined, options?: import("../index.js").RPCRequestOptions | undefined]) => Promise<"response" extends keyof T[K] ? T[K][keyof T[K] & "response"] : void>; } : never;
        };
    };
}
export declare function emitWebviewTagBrowserViewCreated(view: BrowserView): void;
export {};
