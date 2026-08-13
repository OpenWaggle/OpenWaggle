import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions';
import { type ExtensionFrameInvokeMessage } from './extension-frame-host';
export declare function handleFrameInvoke(input: {
    readonly entry: ExtensionContributionRegistryEntry;
    readonly frameId: string;
    readonly frameWindow: Window;
    readonly message: ExtensionFrameInvokeMessage;
    readonly shouldPostResult: () => boolean;
}): Promise<void>;
