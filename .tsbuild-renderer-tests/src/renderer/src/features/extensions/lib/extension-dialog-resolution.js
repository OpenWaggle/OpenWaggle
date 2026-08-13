import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions';
const DIALOG_FAMILY = OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.DIALOGS;
function normalizeDialogId(dialogId) {
    return dialogId.trim();
}
function dialogEntriesForTargetPackage(registry, target) {
    return registry.entries.filter((entry) => entry.family === DIALOG_FAMILY &&
        entry.extensionId === target.extensionId &&
        entry.packagePath === target.packagePath &&
        entry.contentHash === target.contentHash);
}
function disabledForRequestedProject(entry, requestedProjectPaths) {
    const disabledProjectPaths = new Set(entry.eligibility.disabledProjectPaths);
    return requestedProjectPaths.some((projectPath) => disabledProjectPaths.has(projectPath));
}
function missingRequestedProject(entry, requestedProjectPaths) {
    const availableProjectPaths = new Set(entry.projectPaths);
    return requestedProjectPaths.some((projectPath) => !availableProjectPaths.has(projectPath));
}
function isBlockedDialogEntry(entry, requestedProjectPaths) {
    return (!entry.eligibility.runtimeEnabled ||
        !entry.eligibility.enabled ||
        !entry.eligibility.trusted ||
        entry.eligibility.sdkCompatible === false ||
        entry.eligibility.updateAvailable ||
        disabledForRequestedProject(entry, requestedProjectPaths) ||
        missingRequestedProject(entry, requestedProjectPaths));
}
export function resolveExtensionDialogContribution({ registry, target, requestedProjectPaths, }) {
    const extensionId = target.extensionId.trim();
    const dialogId = normalizeDialogId(target.dialogId);
    const packagePath = target.packagePath;
    const contentHash = target.contentHash.trim();
    if (extensionId.length === 0 ||
        dialogId.length === 0 ||
        packagePath.length === 0 ||
        contentHash.length === 0) {
        return {
            status: 'invalid',
            title: 'Invalid extension dialog',
            message: 'Extension dialog requests must include an extension id, dialog contribution id, package path, and content hash.',
        };
    }
    const extensionDialogEntries = dialogEntriesForTargetPackage(registry, {
        extensionId,
        packagePath,
        contentHash,
    });
    if (extensionDialogEntries.length === 0) {
        return {
            status: 'not-found',
            title: 'Extension dialog not available',
            message: 'No registered dialog contributions match this extension package in the active extension registry.',
        };
    }
    const entry = extensionDialogEntries.find((candidate) => candidate.contributionId === dialogId);
    if (!entry) {
        return {
            status: 'not-found',
            title: 'Dialog contribution not available',
            message: 'The requested dialog id is not registered for this extension in the active extension registry.',
        };
    }
    if (isBlockedDialogEntry(entry, requestedProjectPaths)) {
        return {
            status: 'blocked',
            title: 'Extension dialog blocked',
            message: 'This dialog is disabled, untrusted, SDK-incompatible, pending update approval, or outside the active project scope.',
        };
    }
    if (!entry.runtime || !entry.execution || !entry.entryPath) {
        return {
            status: 'invalid',
            title: 'Dialog contribution incomplete',
            message: 'The dialog contribution is missing its renderer runtime, execution placement, or entry path.',
        };
    }
    return {
        status: 'available',
        contribution: {
            entry,
            runtime: entry.runtime,
            execution: entry.execution,
            entryPath: entry.entryPath,
        },
    };
}
