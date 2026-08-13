import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker';
import { api } from '@/shared/lib/ipc';
import { refreshPreferencesAfterExtensionInvoke } from './extension-broker-preferences';
function invocationProjectPath(input) {
    return input.scope.kind === 'app' ? null : input.scope.projectPath;
}
function outOfScopeInvokeFailure(projectPath) {
    return {
        ok: false,
        error: {
            code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE,
            message: `Project "${projectPath}" is outside this extension contribution scope.`,
        },
    };
}
function describeInvokeError(error) {
    return error instanceof Error ? error.message : String(error);
}
export function transportInvokeFailure(error) {
    return {
        ok: false,
        error: {
            code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.TRANSPORT_FAILED,
            message: 'Extension broker transport failed.',
            issues: [describeInvokeError(error)],
        },
    };
}
export function invokeBoundExtension(entry, input) {
    const projectPath = invocationProjectPath(input);
    if (projectPath !== null && !entry.projectPaths.includes(projectPath)) {
        return Promise.resolve(outOfScopeInvokeFailure(projectPath));
    }
    return api.invokeExtension(input).then(async (result) => {
        await refreshPreferencesAfterExtensionInvoke(result);
        return result;
    });
}
