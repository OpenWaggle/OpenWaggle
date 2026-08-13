import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions';
const ROUTE_FAMILY = OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.ROUTES;
function normalizeRouteId(routeId) {
    return routeId.replace(/^\/+|\/+$/g, '');
}
function routeEntriesForExtension(registry, extensionId) {
    return registry.entries.filter((entry) => entry.family === ROUTE_FAMILY && entry.extensionId === extensionId);
}
function disabledForRequestedProject(entry, requestedProjectPaths) {
    const disabledProjectPaths = new Set(entry.eligibility.disabledProjectPaths);
    return requestedProjectPaths.some((projectPath) => disabledProjectPaths.has(projectPath));
}
function missingRequestedProject(entry, requestedProjectPaths) {
    const availableProjectPaths = new Set(entry.projectPaths);
    return requestedProjectPaths.some((projectPath) => !availableProjectPaths.has(projectPath));
}
function isBlockedRouteEntry(entry, requestedProjectPaths) {
    return (!entry.eligibility.runtimeEnabled ||
        !entry.eligibility.enabled ||
        !entry.eligibility.trusted ||
        entry.eligibility.sdkCompatible === false ||
        entry.eligibility.updateAvailable ||
        disabledForRequestedProject(entry, requestedProjectPaths) ||
        missingRequestedProject(entry, requestedProjectPaths));
}
export function resolveExtensionRouteContribution({ registry, extensionId, routeId, requestedProjectPaths, }) {
    const normalizedRouteId = normalizeRouteId(routeId);
    if (extensionId.trim().length === 0 || normalizedRouteId.length === 0) {
        return {
            status: 'invalid',
            title: 'Invalid extension route',
            message: 'Extension route URLs must include both an extension id and a route contribution id.',
        };
    }
    const extensionRouteEntries = routeEntriesForExtension(registry, extensionId);
    if (extensionRouteEntries.length === 0) {
        return {
            status: 'not-found',
            title: 'Extension route not available',
            message: 'No registered route contributions match this extension in the active extension registry.',
        };
    }
    const entry = extensionRouteEntries.find((candidate) => candidate.contributionId === normalizedRouteId);
    if (!entry) {
        return {
            status: 'not-found',
            title: 'Route contribution not available',
            message: 'The requested route id is not registered for this extension in the active extension registry.',
        };
    }
    if (isBlockedRouteEntry(entry, requestedProjectPaths)) {
        return {
            status: 'blocked',
            title: 'Extension route blocked',
            message: 'This route is disabled, untrusted, SDK-incompatible, pending update approval, or outside the active project scope.',
        };
    }
    if (!entry.runtime || !entry.execution || !entry.entryPath) {
        return {
            status: 'invalid',
            title: 'Route contribution incomplete',
            message: 'The route contribution is missing its renderer runtime, execution placement, or entry path.',
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
