import { EXTENSION_FRAME_SURFACE_ACTION } from '@shared/constants/extension-frame';
import { createExtensionBrokerSdkFromInvoke } from '@shared/extension-sdk';
function frameOpenExternal(post) {
    return (url) => {
        post({ type: 'open-external', url });
        return Promise.resolve();
    };
}
function frameSurfaceSdk(post) {
    return {
        sendAction: (actionId, payload) => {
            post(payload === undefined
                ? { type: 'surface-action', actionId }
                : { type: 'surface-action', actionId, payload });
            return Promise.resolve();
        },
        respondInteraction: (value) => {
            post({
                type: 'surface-action',
                actionId: EXTENSION_FRAME_SURFACE_ACTION.CUSTOM_INTERACTION_RESPONSE,
                payload: value,
            });
            return Promise.resolve();
        },
    };
}
export function createFrameExtensionSdk(input) {
    const brokerSdk = createExtensionBrokerSdkFromInvoke(input.invokeBroker, {
        openExternal: frameOpenExternal(input.post),
    });
    return {
        ...brokerSdk,
        surface: frameSurfaceSdk(input.post),
    };
}
