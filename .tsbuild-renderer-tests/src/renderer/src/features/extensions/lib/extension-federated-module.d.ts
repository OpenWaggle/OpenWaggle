import { type OpenWaggleExtensionSdk, type OpenWaggleExtensionSharedModules, type OpenWaggleExtensionSurfaceContext, type OpenWaggleExtensionSurfaceSdk } from '@shared/extension-context';
import { type CreateOpenWaggleSdkOptions, type ExtensionSdkInvokeRequest } from '@shared/extension-sdk';
import type { ExtensionInvokeInput, ExtensionInvokeResult } from '@shared/types/extension-broker';
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions';
import type { JsonValue } from '@shared/types/json';
export type ExtensionMountInvokeInput = ExtensionSdkInvokeRequest;
export type { OpenWaggleExtensionSdk, OpenWaggleExtensionSurfaceSdk };
export interface OpenWaggleExtensionMountContext extends OpenWaggleExtensionSurfaceContext {
    readonly root: HTMLElement;
    readonly sdk: OpenWaggleExtensionSdk;
    readonly modules: OpenWaggleExtensionSharedModules;
}
export type ExtensionFederatedModuleCleanup = () => void;
export type ExtensionFederatedModuleMountResult = undefined | ExtensionFederatedModuleCleanup;
export interface OpenWaggleFederatedModule {
    readonly mount: (context: OpenWaggleExtensionMountContext) => ExtensionFederatedModuleMountResult | Promise<ExtensionFederatedModuleMountResult>;
}
export type ExtensionFederatedModuleLoader = (moduleUrl: string) => Promise<OpenWaggleFederatedModule>;
export declare function isFederatedModule(value: unknown): value is OpenWaggleFederatedModule;
export declare function importFederatedModule(moduleUrl: string): Promise<OpenWaggleFederatedModule>;
export declare function createExtensionMountContext(input: {
    readonly entry: ExtensionContributionRegistryEntry;
    readonly root: HTMLElement;
    readonly surfacePayload?: JsonValue;
    readonly invoke: (input: ExtensionInvokeInput) => Promise<ExtensionInvokeResult>;
    readonly surface?: OpenWaggleExtensionSurfaceSdk;
    readonly sdkOptions?: CreateOpenWaggleSdkOptions;
}): OpenWaggleExtensionMountContext;
