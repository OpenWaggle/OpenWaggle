import { Schema, type SchemaType } from '@shared/schema';
import type { ExtensionInvokeInput, ExtensionInvokeResult } from '@shared/types/extension-broker';
import type { ExtensionFrameConfig } from '@shared/types/extension-frame';
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions';
import type { JsonValue } from '@shared/types/json';
export declare const EXTENSION_FEDERATED_MODULE_IFRAME_SANDBOX = "allow-scripts";
declare const extensionFrameInvokeMessageSchema: Schema.Struct<{
    channel: Schema.Literal<["openwaggle-extension-frame"]>;
    frameId: typeof Schema.String;
    type: Schema.Literal<["invoke"]>;
    requestId: typeof Schema.String;
    input: typeof Schema.Unknown;
}>;
declare const extensionFrameMessageSchema: Schema.Union<[Schema.Struct<{
    channel: Schema.Literal<["openwaggle-extension-frame"]>;
    frameId: typeof Schema.String;
    type: Schema.Literal<["ready"]>;
}>, Schema.Struct<{
    channel: Schema.Literal<["openwaggle-extension-frame"]>;
    frameId: typeof Schema.String;
    type: Schema.Literal<["mounted"]>;
}>, Schema.Struct<{
    channel: Schema.Literal<["openwaggle-extension-frame"]>;
    frameId: typeof Schema.String;
    type: Schema.Literal<["error", "cleanup-error"]>;
    message: typeof Schema.String;
}>, Schema.Struct<{
    channel: Schema.Literal<["openwaggle-extension-frame"]>;
    frameId: typeof Schema.String;
    type: Schema.Literal<["invoke"]>;
    requestId: typeof Schema.String;
    input: typeof Schema.Unknown;
}>, Schema.Struct<{
    channel: Schema.Literal<["openwaggle-extension-frame"]>;
    frameId: typeof Schema.String;
    type: Schema.Literal<["open-external"]>;
    url: typeof Schema.String;
}>, Schema.Struct<{
    channel: Schema.Literal<["openwaggle-extension-frame"]>;
    frameId: typeof Schema.String;
    type: Schema.Literal<["resize"]>;
    height: typeof Schema.Number;
}>, Schema.Struct<{
    channel: Schema.Literal<["openwaggle-extension-frame"]>;
    frameId: typeof Schema.String;
    type: Schema.Literal<["surface-action"]>;
    actionId: typeof Schema.String;
    payload: Schema.optional<Schema.Schema<JsonValue, JsonValue, never>>;
}>]>;
export type ExtensionFrameMessage = SchemaType<typeof extensionFrameMessageSchema>;
export type ExtensionFrameInvokeMessage = SchemaType<typeof extensionFrameInvokeMessageSchema>;
export declare function extensionFrameConfig(input: {
    readonly entry: ExtensionContributionRegistryEntry;
    readonly moduleUrl: string;
    readonly surfacePayload?: JsonValue;
}): {
    moduleUrl: string;
    context: import("@shared/extension-context").OpenWaggleExtensionSurfaceContext;
};
export declare function decodeExtensionFrameMessage(value: unknown, frameId: string): {
    readonly type: "ready";
    readonly channel: "openwaggle-extension-frame";
    readonly frameId: string;
} | {
    readonly type: "mounted";
    readonly channel: "openwaggle-extension-frame";
    readonly frameId: string;
} | {
    readonly message: string;
    readonly type: "error" | "cleanup-error";
    readonly channel: "openwaggle-extension-frame";
    readonly frameId: string;
} | {
    readonly type: "invoke";
    readonly input: unknown;
    readonly channel: "openwaggle-extension-frame";
    readonly frameId: string;
    readonly requestId: string;
} | {
    readonly type: "open-external";
    readonly url: string;
    readonly channel: "openwaggle-extension-frame";
    readonly frameId: string;
} | {
    readonly type: "resize";
    readonly height: number;
    readonly channel: "openwaggle-extension-frame";
    readonly frameId: string;
} | {
    readonly type: "surface-action";
    readonly payload?: JsonValue | undefined;
    readonly channel: "openwaggle-extension-frame";
    readonly frameId: string;
    readonly actionId: string;
} | null;
export declare function extensionInvokeInputFromFrame(entry: ExtensionContributionRegistryEntry, input: unknown): ExtensionInvokeInput | ExtensionInvokeResult;
export declare function postFrameMessage(frameWindow: Pick<Window, 'postMessage'>, frameId: string, message: {
    readonly type: 'dispose';
} | {
    readonly type: 'configure';
    readonly config: ExtensionFrameConfig;
} | {
    readonly type: 'invoke-result';
    readonly requestId: string;
    readonly result: ExtensionInvokeResult;
}): void;
export {};
