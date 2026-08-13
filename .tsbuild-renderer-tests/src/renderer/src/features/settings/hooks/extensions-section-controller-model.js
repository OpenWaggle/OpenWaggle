import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions';
import { createRendererLogger } from '@/shared/lib/logger';
const logger = createRendererLogger('extensions-settings');
export function describeExtensionControllerError(error) {
    return error instanceof Error ? error.message : 'Failed to load extensions.';
}
export function mutationSnapshot(input) {
    return {
        error: input.error,
        pending: input.isPending,
        extensionId: input.variables?.extensionId ?? null,
    };
}
export function extensionMutationState(mutations) {
    return {
        latestError: mutationError({
            trustedError: mutations.trusted.error,
            enabledError: mutations.enabled.error,
            projectDisabledError: mutations.projectDisabled.error,
            updateError: mutations.update.error,
            buildError: mutations.build.error,
            reloadError: mutations.reload.error,
            removeError: mutations.remove.error,
        }),
        pending: hasPendingMutation({
            trustedPending: mutations.trusted.pending,
            enabledPending: mutations.enabled.pending,
            projectDisabledPending: mutations.projectDisabled.pending,
            updatePending: mutations.update.pending,
            buildPending: mutations.build.pending,
            reloadPending: mutations.reload.pending,
            removePending: mutations.remove.pending,
        }),
        updatingId: getUpdatingExtensionId({
            trustedPending: mutations.trusted.pending,
            trustedExtensionId: mutations.trusted.extensionId,
            enabledPending: mutations.enabled.pending,
            enabledExtensionId: mutations.enabled.extensionId,
            projectDisabledPending: mutations.projectDisabled.pending,
            projectDisabledExtensionId: mutations.projectDisabled.extensionId,
            updatePending: mutations.update.pending,
            updateExtensionId: mutations.update.extensionId,
            buildPending: mutations.build.pending,
            buildExtensionId: mutations.build.extensionId,
            reloadPending: mutations.reload.pending,
            reloadExtensionId: mutations.reload.extensionId,
            removePending: mutations.remove.pending,
            removeExtensionId: mutations.remove.extensionId,
        }),
    };
}
export function extensionControllerError(input) {
    return (controllerError({
        queryError: input.extensionsError,
        latestMutationError: input.mutationLatestError,
    }) ??
        input.contributionsError?.message ??
        null);
}
export function getUpdatingExtensionId({ trustedPending, trustedExtensionId, enabledPending, enabledExtensionId, projectDisabledPending, projectDisabledExtensionId, updatePending, updateExtensionId, buildPending, buildExtensionId, reloadPending, reloadExtensionId, removePending, removeExtensionId, }) {
    if (trustedPending) {
        return trustedExtensionId;
    }
    if (enabledPending) {
        return enabledExtensionId;
    }
    if (projectDisabledPending) {
        return projectDisabledExtensionId;
    }
    if (updatePending) {
        return updateExtensionId;
    }
    if (buildPending) {
        return buildExtensionId;
    }
    if (reloadPending) {
        return reloadExtensionId;
    }
    if (removePending) {
        return removeExtensionId;
    }
    return null;
}
export function hasPendingMutation({ trustedPending, enabledPending, projectDisabledPending, updatePending, buildPending, reloadPending, removePending, }) {
    return (trustedPending ||
        enabledPending ||
        projectDisabledPending ||
        updatePending ||
        buildPending ||
        reloadPending ||
        removePending);
}
export function mutationError({ trustedError, enabledError, projectDisabledError, updateError, buildError, reloadError, removeError, }) {
    return (trustedError ??
        enabledError ??
        projectDisabledError ??
        updateError ??
        buildError ??
        reloadError ??
        removeError);
}
export function controllerError({ queryError, latestMutationError, }) {
    if (queryError) {
        return describeExtensionControllerError(queryError);
    }
    return latestMutationError ? describeExtensionControllerError(latestMutationError) : null;
}
export function packageScopeToMutationScope(extensionPackage) {
    if (extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) {
        return { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND };
    }
    if (!extensionPackage.scope.projectPath) {
        throw new Error('Project extension scope is missing a project path.');
    }
    return {
        kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
        projectPath: extensionPackage.scope.projectPath,
    };
}
export function logMutationFailure({ action, extensionPackage, projectPath, viewProjectPaths, error, }) {
    logger.warn('Extension mutation failed', {
        action,
        extensionId: extensionPackage.id,
        scopeKind: extensionPackage.scope.kind,
        projectPath: projectPath ?? 'none',
        viewProjectPaths,
        error: describeExtensionControllerError(error),
    });
}
