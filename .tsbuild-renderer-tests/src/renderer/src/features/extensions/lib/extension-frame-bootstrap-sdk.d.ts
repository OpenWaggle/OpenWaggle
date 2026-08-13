import type { ExtensionSdkInvokeRequest } from '@shared/extension-sdk-core';
import type { ExtensionInvokeResult } from '@shared/types/extension-broker';
import type { JsonValue } from '@shared/types/json';
import type { OpenWaggleExtensionMountContext } from './extension-federated-module';
type ExtensionFrameSdk = OpenWaggleExtensionMountContext['sdk'];
type FramePost = (message: {
    readonly type: 'open-external';
    readonly url: string;
} | {
    readonly type: 'surface-action';
    readonly actionId: string;
    readonly payload?: JsonValue;
}) => void;
export declare function createFrameExtensionSdk(input: {
    readonly invokeBroker: (input: ExtensionSdkInvokeRequest) => Promise<ExtensionInvokeResult>;
    readonly post: FramePost;
}): ExtensionFrameSdk;
export {};
