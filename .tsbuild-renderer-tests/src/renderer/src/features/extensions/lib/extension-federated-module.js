import { createNoopExtensionSurfaceSdk, createOpenWaggleExtensionSharedModules, createOpenWaggleExtensionSurfaceContext, } from '@shared/extension-context';
import { createExtensionBrokerSdk, } from '@shared/extension-sdk';
import { createRendererExtensionTheme } from './extension-theme-context';
function moduleMountExport(value) {
    return Object.getOwnPropertyDescriptor(value, 'mount')?.value;
}
export function isFederatedModule(value) {
    return (typeof value === 'object' && value !== null && typeof moduleMountExport(value) === 'function');
}
function runtimeModuleImport(moduleUrl) {
    return import(/* @vite-ignore */ moduleUrl).then((moduleNamespace) => moduleNamespace);
}
export async function importFederatedModule(moduleUrl) {
    const moduleNamespace = await runtimeModuleImport(moduleUrl);
    if (!isFederatedModule(moduleNamespace)) {
        throw new Error('Extension federated module must export a mount(context) function.');
    }
    return moduleNamespace;
}
export function createExtensionMountContext(input) {
    const identity = {
        extensionId: input.entry.extensionId,
        contributionId: input.entry.contributionId,
    };
    const brokerSdk = input.sdkOptions === undefined
        ? createExtensionBrokerSdk(input.invoke, identity)
        : createExtensionBrokerSdk(input.invoke, identity, input.sdkOptions);
    const sdk = {
        ...brokerSdk,
        surface: input.surface ?? createNoopExtensionSurfaceSdk(),
    };
    const theme = createRendererExtensionTheme();
    return {
        ...createOpenWaggleExtensionSurfaceContext({
            entry: input.entry,
            surfacePayload: input.surfacePayload,
            theme,
        }),
        root: input.root,
        sdk,
        modules: createOpenWaggleExtensionSharedModules(theme),
    };
}
