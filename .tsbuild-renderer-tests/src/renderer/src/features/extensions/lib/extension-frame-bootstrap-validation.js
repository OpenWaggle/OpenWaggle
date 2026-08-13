import { EXTENSION_FRAME_MESSAGE_CHANNEL } from '@shared/constants/extension-frame';
import { isOpenWaggleExtensionTheme } from '@shared/extension-theme';
import { isRecord } from '@shared/utils/validation';
import { isOptionalJsonValue, stringArray } from './extension-frame-bootstrap-json';
import { isInvokeResult } from './extension-frame-bootstrap-results';
function moduleMountExport(value) {
    return Object.getOwnPropertyDescriptor(value, 'mount')?.value;
}
export function isFederatedModule(value) {
    return (typeof value === 'object' && value !== null && typeof moduleMountExport(value) === 'function');
}
function isExtensionMetadata(value) {
    return (isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.name === 'string' &&
        typeof value.version === 'string');
}
function isContributionMetadata(value) {
    return (isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.title === 'string' &&
        typeof value.family === 'string');
}
function isSurfaceMetadata(value) {
    return (isRecord(value) &&
        typeof value.family === 'string' &&
        typeof value.execution === 'string' &&
        isOptionalJsonValue(value.payload));
}
function isFrameContext(value) {
    return (isRecord(value) &&
        isExtensionMetadata(value.extension) &&
        isContributionMetadata(value.contribution) &&
        isSurfaceMetadata(value.surface) &&
        typeof value.packagePath === 'string' &&
        stringArray(value.projectPaths) &&
        isOpenWaggleExtensionTheme(value.theme));
}
function isExtensionFrameConfig(value) {
    return isRecord(value) && typeof value.moduleUrl === 'string' && isFrameContext(value.context);
}
export function decodedParentMessage(value, frameId) {
    if (!isRecord(value) ||
        value.channel !== EXTENSION_FRAME_MESSAGE_CHANNEL ||
        value.frameId !== frameId) {
        return null;
    }
    if (value.type === 'dispose') {
        return { type: 'dispose' };
    }
    if (value.type === 'configure' && isExtensionFrameConfig(value.config)) {
        return { type: 'configure', config: value.config };
    }
    if (value.type === 'invoke-result' &&
        typeof value.requestId === 'string' &&
        isInvokeResult(value.result)) {
        return { type: 'invoke-result', requestId: value.requestId, result: value.result };
    }
    return null;
}
