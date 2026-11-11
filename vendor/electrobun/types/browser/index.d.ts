import { type RPCSchema, type RPCTransport, type RPCRequestOptions, type ElectrobunRPCSchema, type ElectrobunRPCConfig, type RPCWithTransport, createRPC } from "../shared/rpc.js";
import { type WebviewTagElement, type WebviewEventTypes } from "./webviewtag";
import { type WgpuTagElement, type WgpuEventTypes } from "./wgputag";
import "./global.d.ts";
type QueuedHostMessage = {
    message: string;
    markSent: () => void;
};
declare class Electroview<T extends RPCWithTransport> {
    hostSocket?: WebSocket;
    hostSocketCanSend: boolean;
    pendingHostSocketMessages: QueuedHostMessage[];
    flushingHostSocketMessages: boolean;
    hostSocketSendQueue: QueuedHostMessage[];
    flushingHostSocketSendQueue: boolean;
    linuxHostSocketDispatchTail: Promise<void>;
    rpc?: T;
    rpcHandler?: (msg: unknown) => void;
    carrots: {
        invoke: <R = unknown>(carrotId: string, method: string, params?: unknown, options?: {
            windowId?: string;
        }) => Promise<R>;
    };
    constructor(config: {
        rpc: T;
    });
    init(): void;
    initSocketToHost(): void;
    queueLinuxHostSocketDispatch(decodedMessage: Promise<unknown>): void;
    createTransport(): RPCTransport;
    sendMessageToHost(msg: string): Promise<void>;
    canSendToHostSocket(): boolean;
    sendMessageToHostSocket(msg: string): Promise<boolean>;
    sendMessageToHostViaFallback(queuedMessage: QueuedHostMessage): void;
    flushHostMessagesViaFallback(queue: QueuedHostMessage[]): void;
    flushHostSocketSendQueue(): Promise<void>;
    flushPendingHostSocketMessages(): Promise<void>;
    receiveMessageFromHost(msg: unknown): void;
    invokeCarrot<R = unknown>(carrotId: string, method: string, params?: unknown, options?: {
        windowId?: string;
    }): Promise<R>;
    static defineRPC<Schema extends ElectrobunRPCSchema>(config: ElectrobunRPCConfig<Schema, "webview">): {
        setTransport: (newTransport: RPCTransport) => void;
        setRequestHandler: (h: import("../shared/rpc.js").RPCRequestHandler<Schema["webview"]["requests"]>) => void;
        request: (<M extends keyof Schema["bun"]["requests"]>(method: M, ...args: "params" extends keyof Schema["bun"]["requests"][M] ? undefined extends Schema["bun"]["requests"][M][keyof Schema["bun"]["requests"][M] & "params"] ? [params?: Schema["bun"]["requests"][M][keyof Schema["bun"]["requests"][M] & "params"] | undefined, options?: RPCRequestOptions | undefined] : [params: Schema["bun"]["requests"][M][keyof Schema["bun"]["requests"][M] & "params"], options?: RPCRequestOptions | undefined] : [params?: undefined, options?: RPCRequestOptions | undefined]) => Promise<"response" extends keyof Schema["bun"]["requests"][M] ? Schema["bun"]["requests"][M][keyof Schema["bun"]["requests"][M] & "response"] : void>) & (Schema["bun"]["requests"] extends infer T extends {
            [key: string]: {
                params: unknown;
                response: unknown;
            };
        } ? { [K in keyof T]: (...args: "params" extends keyof T[K] ? undefined extends T[K][keyof T[K] & "params"] ? [params?: T[K][keyof T[K] & "params"] | undefined, options?: RPCRequestOptions | undefined] : [params: T[K][keyof T[K] & "params"], options?: RPCRequestOptions | undefined] : [params?: undefined, options?: RPCRequestOptions | undefined]) => Promise<"response" extends keyof T[K] ? T[K][keyof T[K] & "response"] : void>; } : never);
        requestProxy: Schema["bun"]["requests"] extends infer T extends {
            [key: string]: {
                params: unknown;
                response: unknown;
            };
        } ? { [K in keyof T]: (...args: "params" extends keyof T[K] ? undefined extends T[K][keyof T[K] & "params"] ? [params?: T[K][keyof T[K] & "params"] | undefined, options?: RPCRequestOptions | undefined] : [params: T[K][keyof T[K] & "params"], options?: RPCRequestOptions | undefined] : [params?: undefined, options?: RPCRequestOptions | undefined]) => Promise<"response" extends keyof T[K] ? T[K][keyof T[K] & "response"] : void>; } : never;
        send: (<M extends keyof Schema["bun"]["messages"]>(message: M, ...args: void extends Schema["bun"]["messages"][M] ? [] : undefined extends Schema["bun"]["messages"][M] ? [payload?: Schema["bun"]["messages"][M] | undefined] : [payload: Schema["bun"]["messages"][M]]) => void | PromiseLike<void>) & (Schema["bun"]["messages"] extends infer T_1 extends {} ? { [K in keyof T_1]-?: (...args: void extends T_1[K] ? [] : undefined extends T_1[K] ? [payload?: T_1[K] | undefined] : [payload: T_1[K]]) => void | PromiseLike<void>; } : never);
        sendProxy: Schema["bun"]["messages"] extends infer T_1 extends {} ? { [K in keyof T_1]-?: (...args: void extends T_1[K] ? [] : undefined extends T_1[K] ? [payload?: T_1[K] | undefined] : [payload: T_1[K]]) => void | PromiseLike<void>; } : never;
        addMessageListener: {
            (message: "*", listener: import("../shared/rpc.js").WildcardRPCMessageHandlerFn<Schema["webview"]["messages"]>): void;
            <M extends keyof Schema["webview"]["messages"]>(message: M, listener: import("../shared/rpc.js").RPCMessageHandlerFn<Schema["webview"]["messages"], M>): void;
        };
        removeMessageListener: {
            (message: "*", listener: import("../shared/rpc.js").WildcardRPCMessageHandlerFn<Schema["webview"]["messages"]>): void;
            <M extends keyof Schema["webview"]["messages"]>(message: M, listener: import("../shared/rpc.js").RPCMessageHandlerFn<Schema["webview"]["messages"], M>): void;
        };
        proxy: {
            send: Schema["bun"]["messages"] extends infer T_1 extends {} ? { [K in keyof T_1]-?: (...args: void extends T_1[K] ? [] : undefined extends T_1[K] ? [payload?: T_1[K] | undefined] : [payload: T_1[K]]) => void | PromiseLike<void>; } : never;
            request: Schema["bun"]["requests"] extends infer T extends {
                [key: string]: {
                    params: unknown;
                    response: unknown;
                };
            } ? { [K in keyof T]: (...args: "params" extends keyof T[K] ? undefined extends T[K][keyof T[K] & "params"] ? [params?: T[K][keyof T[K] & "params"] | undefined, options?: RPCRequestOptions | undefined] : [params: T[K][keyof T[K] & "params"], options?: RPCRequestOptions | undefined] : [params?: undefined, options?: RPCRequestOptions | undefined]) => Promise<"response" extends keyof T[K] ? T[K][keyof T[K] & "response"] : void>; } : never;
        };
    };
}
export { type RPCSchema, type RPCRequestOptions, type ElectrobunRPCSchema, type ElectrobunRPCConfig, createRPC, Electroview, type WebviewTagElement, type WebviewEventTypes, type WgpuTagElement, type WgpuEventTypes, };
declare const Electrobun: {
    Electroview: typeof Electroview;
};
export default Electrobun;
