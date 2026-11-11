type _RPCRequestPacket = {
    type: "request";
    id: number;
    method: string;
    params: any;
};
type _RPCResponsePacket = {
    type: "response";
    id: number;
    success: true;
    payload: any;
} | {
    type: "response";
    id: number;
    success: false;
    error?: string;
};
type _RPCMessagePacket = {
    type: "message";
    id: string;
    payload: any;
};
type _RPCPacket = _RPCRequestPacket | _RPCResponsePacket | _RPCMessagePacket;
type BaseRPCRequestsSchema = {
    [key: string]: {
        params: unknown;
        response: unknown;
    };
};
export type RPCRequestsSchema<T extends BaseRPCRequestsSchema = BaseRPCRequestsSchema> = T;
type RPCRequestParams<RS extends RPCRequestsSchema, M extends keyof RS = keyof RS> = "params" extends keyof RS[M] ? RS[M]["params"] : never;
type RPCRequestResponse<RS extends RPCRequestsSchema, M extends keyof RS = keyof RS> = "response" extends keyof RS[M] ? RS[M]["response"] : void;
export type RPCRequestOptions = {
    /**
     * Maximum time in milliseconds to await this request.
     * Infinity disables the timeout.
     */
    maxRequestTime?: number;
};
type BaseRPCMessagesSchema = Record<never, unknown>;
export type RPCMessagesSchema<T extends BaseRPCMessagesSchema = BaseRPCMessagesSchema> = T;
type RPCMessagePayload<MS extends RPCMessagesSchema, N extends keyof MS = keyof MS> = MS[N];
type InputRPCSchema = {
    requests?: RPCRequestsSchema;
    messages?: RPCMessagesSchema;
};
type ResolvedRPCSchema<I extends InputRPCSchema> = {
    requests: undefined extends I["requests"] ? BaseRPCRequestsSchema : NonNullable<I["requests"]>;
    messages: undefined extends I["messages"] ? BaseRPCMessagesSchema : NonNullable<I["messages"]>;
};
export type RPCSchema<I extends InputRPCSchema | void = InputRPCSchema> = ResolvedRPCSchema<I extends InputRPCSchema ? I : InputRPCSchema>;
type RPCRequestHandlerFn<RS extends RPCRequestsSchema = RPCRequestsSchema> = <M extends keyof RS>(method: M, params: RPCRequestParams<RS, M>) => any | Promise<any>;
type RPCRequestHandlerObject<RS extends RPCRequestsSchema = RPCRequestsSchema> = {
    [M in keyof RS]?: (...args: "params" extends keyof RS[M] ? undefined extends RS[M]["params"] ? [params?: RS[M]["params"]] : [params: RS[M]["params"]] : []) => Awaited<RPCRequestResponse<RS, M>> | Promise<Awaited<RPCRequestResponse<RS, M>>>;
} & {
    _?: (method: keyof RS, params: RPCRequestParams<RS>) => any;
};
export type RPCRequestHandler<RS extends RPCRequestsSchema = RPCRequestsSchema> = RPCRequestHandlerFn<RS> | RPCRequestHandlerObject<RS>;
export type RPCMessageHandlerFn<MS extends RPCMessagesSchema, N extends keyof MS> = (payload: RPCMessagePayload<MS, N>) => void;
export type WildcardRPCMessageHandlerFn<MS extends RPCMessagesSchema> = (messageName: keyof MS, payload: RPCMessagePayload<MS>) => void;
type RPCRequestsProxy<RS extends RPCRequestsSchema> = {
    [K in keyof RS]: (...args: "params" extends keyof RS[K] ? undefined extends RS[K]["params"] ? [params?: RS[K]["params"], options?: RPCRequestOptions] : [params: RS[K]["params"], options?: RPCRequestOptions] : [params?: undefined, options?: RPCRequestOptions]) => Promise<RPCRequestResponse<RS, K>>;
};
type RPCMessagesProxy<MS extends RPCMessagesSchema> = {
    [K in keyof MS]-?: (...args: void extends MS[K] ? [] : undefined extends MS[K] ? [payload?: MS[K]] : [payload: MS[K]]) => void | PromiseLike<void>;
};
type RPCTransportHandler = (data: any) => void;
export type RPCTransport = {
    send?: (data: any) => void | PromiseLike<void>;
    registerHandler?: (handler: RPCTransportHandler) => void;
    unregisterHandler?: () => void;
};
type DebugHooks = {
    onSend?: (packet: _RPCPacket) => void;
    onReceive?: (packet: _RPCPacket) => void;
};
type _RPCAllOptions<S extends RPCSchema> = {
    transport?: RPCTransport;
    requestHandler?: RPCRequestHandler<S["requests"]>;
    maxRequestTime?: number;
    _debugHooks?: DebugHooks;
};
type RPCBaseOption = "transport" | "_debugHooks";
type RPCRequestsInOption = "requestHandler";
type RPCRequestsOutOption = "maxRequestTime";
type OptionsByLocalSchema<S extends RPCSchema> = NonNullable<unknown> extends S["requests"] ? never : RPCRequestsInOption;
type OptionsByRemoteSchema<RS extends RPCSchema> = NonNullable<unknown> extends RS["requests"] ? never : RPCRequestsOutOption;
export type RPCOptions<S extends RPCSchema, RS extends RPCSchema> = Pick<_RPCAllOptions<S>, RPCBaseOption | OptionsByLocalSchema<S> | OptionsByRemoteSchema<RS>>;
export declare function createRPC<Schema extends RPCSchema = RPCSchema, RemoteSchema extends RPCSchema = Schema>(options?: _RPCAllOptions<Schema>): {
    setTransport: (newTransport: RPCTransport) => void;
    setRequestHandler: (h: RPCRequestHandler<Schema["requests"]>) => void;
    request: (<M extends keyof RemoteSchema["requests"]>(method: M, ...args: "params" extends keyof RemoteSchema["requests"][M] ? undefined extends RemoteSchema["requests"][M]["params"] ? [params?: RemoteSchema["requests"][M]["params"], options?: RPCRequestOptions] : [params: RemoteSchema["requests"][M]["params"], options?: RPCRequestOptions] : [params?: undefined, options?: RPCRequestOptions]) => Promise<RPCRequestResponse<RemoteSchema["requests"], M>>) & RPCRequestsProxy<RemoteSchema["requests"]>;
    requestProxy: RPCRequestsProxy<RemoteSchema["requests"]>;
    send: (<M extends keyof Schema["messages"]>(message: M, ...args: void extends RPCMessagePayload<Schema["messages"], M> ? [] : undefined extends RPCMessagePayload<Schema["messages"], M> ? [payload?: RPCMessagePayload<Schema["messages"], M>] : [payload: RPCMessagePayload<Schema["messages"], M>]) => void | PromiseLike<void>) & RPCMessagesProxy<Schema["messages"]>;
    sendProxy: RPCMessagesProxy<Schema["messages"]>;
    addMessageListener: {
        (message: "*", listener: WildcardRPCMessageHandlerFn<RemoteSchema["messages"]>): void;
        <M extends keyof RemoteSchema["messages"]>(message: M, listener: RPCMessageHandlerFn<RemoteSchema["messages"], M>): void;
    };
    removeMessageListener: {
        (message: "*", listener: WildcardRPCMessageHandlerFn<RemoteSchema["messages"]>): void;
        <M extends keyof RemoteSchema["messages"]>(message: M, listener: RPCMessageHandlerFn<RemoteSchema["messages"], M>): void;
    };
    proxy: {
        send: RPCMessagesProxy<Schema["messages"]>;
        request: RPCRequestsProxy<RemoteSchema["requests"]>;
    };
};
export interface ElectrobunRPCSchema {
    bun: RPCSchema;
    webview: RPCSchema;
}
export interface RPCWithTransport {
    setTransport: (transport: RPCTransport) => void;
}
export type ElectrobunRPCConfig<Schema extends ElectrobunRPCSchema, Side extends "bun" | "webview"> = {
    maxRequestTime?: number;
    handlers: {
        requests?: RPCRequestHandler<Schema[Side]["requests"]>;
        messages?: {
            [K in keyof Schema[Side]["messages"]]?: RPCMessageHandlerFn<Schema[Side]["messages"], K>;
        } & {
            "*"?: WildcardRPCMessageHandlerFn<Schema[Side]["messages"]>;
        };
    };
};
export declare function defineElectrobunRPC<Schema extends ElectrobunRPCSchema, Side extends "bun" | "webview" = "bun" | "webview">(_side: Side, config: ElectrobunRPCConfig<Schema, Side> & {
    extraRequestHandlers?: Record<string, Function>;
}): {
    setTransport: (newTransport: RPCTransport) => void;
    setRequestHandler: (h: RPCRequestHandler<Schema[Side]["requests"]>) => void;
    request: (<M extends keyof Schema[Side extends "bun" ? "webview" : "bun"]["requests"]>(method: M, ...args: "params" extends keyof Schema[Side extends "bun" ? "webview" : "bun"]["requests"][M] ? undefined extends Schema[Side extends "bun" ? "webview" : "bun"]["requests"][M][keyof Schema[Side extends "bun" ? "webview" : "bun"]["requests"][M] & "params"] ? [params?: Schema[Side extends "bun" ? "webview" : "bun"]["requests"][M][keyof Schema[Side extends "bun" ? "webview" : "bun"]["requests"][M] & "params"] | undefined, options?: RPCRequestOptions | undefined] : [params: Schema[Side extends "bun" ? "webview" : "bun"]["requests"][M][keyof Schema[Side extends "bun" ? "webview" : "bun"]["requests"][M] & "params"], options?: RPCRequestOptions | undefined] : [params?: undefined, options?: RPCRequestOptions | undefined]) => Promise<RPCRequestResponse<Schema[Side extends "bun" ? "webview" : "bun"]["requests"], M>>) & RPCRequestsProxy<Schema[Side extends "bun" ? "webview" : "bun"]["requests"]>;
    requestProxy: RPCRequestsProxy<Schema[Side extends "bun" ? "webview" : "bun"]["requests"]>;
    send: (<M extends keyof Schema[Side extends "bun" ? "webview" : "bun"]["messages"]>(message: M, ...args: void extends RPCMessagePayload<Schema[Side extends "bun" ? "webview" : "bun"]["messages"], M> ? [] : undefined extends RPCMessagePayload<Schema[Side extends "bun" ? "webview" : "bun"]["messages"], M> ? [payload?: RPCMessagePayload<Schema[Side extends "bun" ? "webview" : "bun"]["messages"], M> | undefined] : [payload: RPCMessagePayload<Schema[Side extends "bun" ? "webview" : "bun"]["messages"], M>]) => void | PromiseLike<void>) & RPCMessagesProxy<Schema[Side extends "bun" ? "webview" : "bun"]["messages"]>;
    sendProxy: RPCMessagesProxy<Schema[Side extends "bun" ? "webview" : "bun"]["messages"]>;
    addMessageListener: {
        (message: "*", listener: WildcardRPCMessageHandlerFn<Schema[Side]["messages"]>): void;
        <M extends keyof Schema[Side]["messages"]>(message: M, listener: RPCMessageHandlerFn<Schema[Side]["messages"], M>): void;
    };
    removeMessageListener: {
        (message: "*", listener: WildcardRPCMessageHandlerFn<Schema[Side]["messages"]>): void;
        <M extends keyof Schema[Side]["messages"]>(message: M, listener: RPCMessageHandlerFn<Schema[Side]["messages"], M>): void;
    };
    proxy: {
        send: RPCMessagesProxy<Schema[Side extends "bun" ? "webview" : "bun"]["messages"]>;
        request: RPCRequestsProxy<Schema[Side extends "bun" ? "webview" : "bun"]["requests"]>;
    };
};
export {};
