import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions';
const SURFACE_FAMILY = {
    tool: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TOOL_RENDERERS,
    'custom-message': OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.CUSTOM_MESSAGE_RENDERERS,
    interaction: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.INTERACTION_RENDERERS,
    status: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.STATUS_WIDGETS,
    transcript: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TRANSCRIPT_RENDERERS,
};
function normalized(value) {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
function includesDeclaredMatch(values, requested) {
    return (values !== undefined &&
        values.length > 0 &&
        requested !== undefined &&
        values.includes(requested));
}
function disabledForRequestedProject(entry, requestedProjectPaths) {
    const disabledProjectPaths = new Set(entry.eligibility.disabledProjectPaths);
    return requestedProjectPaths.some((projectPath) => disabledProjectPaths.has(projectPath));
}
function missingRequestedProject(entry, requestedProjectPaths) {
    const availableProjectPaths = new Set(entry.projectPaths);
    return requestedProjectPaths.some((projectPath) => !availableProjectPaths.has(projectPath));
}
function isBlockedEntry(entry, requestedProjectPaths) {
    return (!entry.eligibility.runtimeEnabled ||
        !entry.eligibility.enabled ||
        !entry.eligibility.trusted ||
        entry.eligibility.sdkCompatible === false ||
        entry.eligibility.updateAvailable ||
        disabledForRequestedProject(entry, requestedProjectPaths) ||
        missingRequestedProject(entry, requestedProjectPaths));
}
export function extensionAgentLoopEntryMatchesTarget(entry, target) {
    const extensionId = normalized(target.extensionId);
    if (extensionId !== undefined && entry.extensionId !== extensionId) {
        return false;
    }
    const contributionId = normalized(target.contributionId);
    if (contributionId !== undefined && entry.contributionId !== contributionId) {
        return false;
    }
    if (target.surface === 'tool' &&
        !includesDeclaredMatch(entry.matches?.toolNames, normalized(target.toolName))) {
        return false;
    }
    if (target.surface === 'custom-message' &&
        !includesDeclaredMatch(entry.matches?.customMessageNames, normalized(target.customMessageName))) {
        return false;
    }
    if (target.surface === 'interaction' &&
        !includesDeclaredMatch(entry.matches?.interactionKinds, normalized(target.interactionKind))) {
        return false;
    }
    return true;
}
function candidateEntries(registry, target) {
    const family = SURFACE_FAMILY[target.surface];
    return registry.entries.filter((entry) => entry.family === family && extensionAgentLoopEntryMatchesTarget(entry, target));
}
function resolvedContributionFromEntry(entry) {
    if (!entry.runtime || !entry.execution || !entry.entryPath) {
        return null;
    }
    return {
        entry,
        runtime: entry.runtime,
        execution: entry.execution,
        entryPath: entry.entryPath,
    };
}
function notFoundResolution() {
    return {
        status: 'not-found',
        title: 'Extension renderer not available',
        message: 'No registered extension renderer matches this agent-loop surface.',
    };
}
function blockedResolution() {
    return {
        status: 'blocked',
        title: 'Extension renderer blocked',
        message: 'This renderer is disabled, untrusted, SDK-incompatible, pending update approval, or outside the active project scope.',
    };
}
function invalidResolution() {
    return {
        status: 'invalid',
        title: 'Extension renderer incomplete',
        message: 'The renderer contribution is missing its runtime, execution placement, or entry path.',
    };
}
export function resolveExtensionAgentLoopContribution({ registry, target, requestedProjectPaths, }) {
    const candidates = candidateEntries(registry, target);
    let firstBlocked = null;
    let firstInvalid = null;
    for (const entry of candidates) {
        if (isBlockedEntry(entry, requestedProjectPaths)) {
            firstBlocked ??= blockedResolution();
            continue;
        }
        const contribution = resolvedContributionFromEntry(entry);
        if (contribution === null) {
            firstInvalid ??= invalidResolution();
            continue;
        }
        return {
            status: 'available',
            contribution,
        };
    }
    return firstInvalid ?? firstBlocked ?? notFoundResolution();
}
export function resolveExtensionAgentLoopContributionEntries({ registry, target, requestedProjectPaths, family, }) {
    const contributions = [];
    for (const entry of registry.entries) {
        if (entry.family !== family || !extensionAgentLoopEntryMatchesTarget(entry, target)) {
            continue;
        }
        if (isBlockedEntry(entry, requestedProjectPaths)) {
            continue;
        }
        const contribution = resolvedContributionFromEntry(entry);
        if (contribution !== null) {
            contributions.push(contribution);
        }
    }
    return contributions;
}
