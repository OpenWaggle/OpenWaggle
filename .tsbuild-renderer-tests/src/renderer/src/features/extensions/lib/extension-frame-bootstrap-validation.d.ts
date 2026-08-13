import type { ExtensionInvokeResult } from '@shared/types/extension-broker';
import type { ExtensionFrameConfig } from '@shared/types/extension-frame';
import type { OpenWaggleFederatedModule } from './extension-federated-module';
export type ExtensionFrameParentMessage = {
    readonly type: 'configure';
    readonly config: ExtensionFrameConfig;
} | {
    readonly type: 'dispose';
} | {
    readonly type: 'invoke-result';
    readonly requestId: string;
    readonly result: ExtensionInvokeResult;
};
export declare function isFederatedModule(value: unknown): value is OpenWaggleFederatedModule;
export declare function decodedParentMessage(value: unknown, frameId: string): ExtensionFrameParentMessage | null;
