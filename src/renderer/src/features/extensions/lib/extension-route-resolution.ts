import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
  ExtensionContributionUiLane,
} from '@shared/types/extensions'

export interface ResolvedExtensionRouteContribution {
  readonly entry: ExtensionContributionRegistryEntry
  readonly lane: ExtensionContributionUiLane
  readonly entryPath: string
}

export type ExtensionRouteResolution =
  | {
      readonly status: 'available'
      readonly contribution: ResolvedExtensionRouteContribution
    }
  | {
      readonly status: 'not-found'
      readonly title: string
      readonly message: string
    }
  | {
      readonly status: 'blocked'
      readonly title: string
      readonly message: string
    }
  | {
      readonly status: 'invalid'
      readonly title: string
      readonly message: string
    }

const ROUTE_FAMILY = OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.ROUTES

function normalizeRouteId(routeId: string) {
  return routeId.replace(/^\/+|\/+$/g, '')
}

function routeEntriesForExtension(
  registry: ExtensionContributionRegistryView,
  extensionId: string,
) {
  return registry.entries.filter(
    (entry) => entry.family === ROUTE_FAMILY && entry.extensionId === extensionId,
  )
}

function disabledForRequestedProject(
  entry: ExtensionContributionRegistryEntry,
  requestedProjectPaths: readonly string[],
) {
  return requestedProjectPaths.some((projectPath) =>
    entry.eligibility.disabledProjectPaths.includes(projectPath),
  )
}

function missingRequestedProject(
  entry: ExtensionContributionRegistryEntry,
  requestedProjectPaths: readonly string[],
) {
  return requestedProjectPaths.some((projectPath) => !entry.projectPaths.includes(projectPath))
}

function isBlockedRouteEntry(
  entry: ExtensionContributionRegistryEntry,
  requestedProjectPaths: readonly string[],
) {
  return (
    !entry.eligibility.runtimeEnabled ||
    !entry.eligibility.enabled ||
    !entry.eligibility.trusted ||
    entry.eligibility.sdkCompatible === false ||
    entry.eligibility.updateAvailable ||
    disabledForRequestedProject(entry, requestedProjectPaths) ||
    missingRequestedProject(entry, requestedProjectPaths)
  )
}

export function resolveExtensionRouteContribution({
  registry,
  extensionId,
  routeId,
  requestedProjectPaths,
}: {
  readonly registry: ExtensionContributionRegistryView
  readonly extensionId: string
  readonly routeId: string
  readonly requestedProjectPaths: readonly string[]
}): ExtensionRouteResolution {
  const normalizedRouteId = normalizeRouteId(routeId)

  if (extensionId.trim().length === 0 || normalizedRouteId.length === 0) {
    return {
      status: 'invalid',
      title: 'Invalid extension route',
      message:
        'Extension route URLs must include both an extension id and a route contribution id.',
    }
  }

  const extensionRouteEntries = routeEntriesForExtension(registry, extensionId)
  if (extensionRouteEntries.length === 0) {
    return {
      status: 'not-found',
      title: 'Extension route not available',
      message:
        'No registered route contributions match this extension in the active extension registry.',
    }
  }

  const entry = extensionRouteEntries.find(
    (candidate) => candidate.contributionId === normalizedRouteId,
  )
  if (!entry) {
    return {
      status: 'not-found',
      title: 'Route contribution not available',
      message:
        'The requested route id is not registered for this extension in the active extension registry.',
    }
  }

  if (isBlockedRouteEntry(entry, requestedProjectPaths)) {
    return {
      status: 'blocked',
      title: 'Extension route blocked',
      message:
        'This route is disabled, untrusted, SDK-incompatible, pending update approval, or outside the active project scope.',
    }
  }

  if (!entry.lane || !entry.entryPath) {
    return {
      status: 'invalid',
      title: 'Route contribution incomplete',
      message: 'The route contribution is missing its renderer lane or entry path.',
    }
  }

  return {
    status: 'available',
    contribution: {
      entry,
      lane: entry.lane,
      entryPath: entry.entryPath,
    },
  }
}
