import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionAcceptUpdateInput,
  ExtensionApproveBuildInput,
  ExtensionLifecycleMutationTarget,
  ExtensionReloadInput,
  ExtensionSetEnabledInput,
  ExtensionSetProjectDisabledInput,
  ExtensionSetTrustedInput,
} from '@shared/types/extensions'
import {
  getExtensionGrantIds,
  getMissingExtensionGrantIds,
  isExtensionBuildPlanApproved,
} from '../extensions/runtime-eligibility'
import type {
  DiscoveredExtensionPackage,
  ExtensionBuildRunStatus,
  ExtensionDiagnostic,
  ExtensionLifecycleKey,
  ExtensionLifecycleState,
  ExtensionPackageScope,
  ExtensionProjectOverrideKey,
  ExtensionReloadStatus,
} from '../extensions/types'

export type LifecycleMutationInput =
  | ExtensionSetTrustedInput
  | ExtensionSetEnabledInput
  | ExtensionAcceptUpdateInput
  | ExtensionApproveBuildInput
  | ExtensionReloadInput

function scopeKey(scope: ExtensionPackageScope) {
  return scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
    ? `${OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND}:${OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_ID}`
    : `${OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND}:${scope.projectPath}`
}

function scopeMatches(left: ExtensionPackageScope, right: ExtensionPackageScope) {
  return scopeKey(left) === scopeKey(right)
}

export function getViewProjectPaths(input: LifecycleMutationInput) {
  if (input.viewProjectPaths !== undefined && input.viewProjectPaths.length > 0) {
    return input.viewProjectPaths
  }

  return input.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND
    ? [input.scope.projectPath]
    : []
}

export function getProjectDisabledViewProjectPaths(input: ExtensionSetProjectDisabledInput) {
  if (input.viewProjectPaths !== undefined && input.viewProjectPaths.length > 0) {
    return input.viewProjectPaths
  }

  return [input.projectPath]
}

export function getLifecycleDiscoveryProjectPath(input: LifecycleMutationInput) {
  return input.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND
    ? input.scope.projectPath
    : null
}

export function lifecycleKey(input: LifecycleMutationInput) {
  return {
    extensionId: input.extensionId,
    scope: input.scope,
  } satisfies ExtensionLifecycleKey
}

export function projectOverrideKey(input: ExtensionSetProjectDisabledInput) {
  return {
    extensionId: input.extensionId,
    scope: input.scope,
    projectPath: input.projectPath,
  } satisfies ExtensionProjectOverrideKey
}

export function findPackage(
  packages: readonly DiscoveredExtensionPackage[],
  input: ExtensionLifecycleMutationTarget,
) {
  return (
    packages.find(
      (extensionPackage) =>
        extensionPackage.id === input.extensionId &&
        scopeMatches(extensionPackage.scope, input.scope),
    ) ?? null
  )
}

function getPackageErrorCodes(extensionPackage: DiscoveredExtensionPackage) {
  const errorCodes: string[] = []
  for (const diagnostic of extensionPackage.diagnostics) {
    if (diagnostic.severity === 'error') {
      errorCodes.push(diagnostic.code)
    }
  }
  return errorCodes
}

function getBuildPlanReadinessError(
  extensionPackage: DiscoveredExtensionPackage,
  lifecycle: ExtensionLifecycleState | null,
) {
  const buildPlan = extensionPackage.buildPlan
  if (buildPlan?.approvalRequired !== true) {
    return OPENWAGGLE_EXTENSION.LIFECYCLE.BUILD_APPROVAL_REQUIRED_ERROR
  }
  if (
    buildPlan.inputHash !== null &&
    lifecycle?.approvedBuildPlanHash === buildPlan.inputHash &&
    lifecycle.buildStatus === OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.FAILED
  ) {
    return 'the approved local build failed.'
  }
  return OPENWAGGLE_EXTENSION.LIFECYCLE.BUILD_APPROVAL_REQUIRED_ERROR
}

export function getLifecycleReadinessError(
  extensionPackage: DiscoveredExtensionPackage,
  action: 'trust' | 'enable',
  lifecycle: ExtensionLifecycleState | null,
) {
  if (!extensionPackage.manifest) {
    return `Cannot ${action} "${extensionPackage.id}" because its manifest is invalid.`
  }
  if (!extensionPackage.contentHash) {
    return `Cannot ${action} "${extensionPackage.id}" because its content hash is unavailable.`
  }
  if (!extensionPackage.sdkCompatibility?.compatible) {
    return `Cannot ${action} "${extensionPackage.id}" because its SDK range is incompatible.`
  }
  if (!isExtensionBuildPlanApproved({ extensionPackage, lifecycle })) {
    return `Cannot ${action} "${extensionPackage.id}" because ${getBuildPlanReadinessError(extensionPackage, lifecycle)}`
  }
  if (action === 'enable' && lifecycle) {
    const missingGrantIds = getMissingExtensionGrantIds({ extensionPackage, lifecycle })
    if (missingGrantIds.length > 0) {
      return `Cannot enable "${extensionPackage.id}" because required permissions have not been granted: ${missingGrantIds.join(', ')}.`
    }
  }

  const errorCodes = getPackageErrorCodes(extensionPackage)
  if (errorCodes.length > 0) {
    return `Cannot ${action} "${extensionPackage.id}" because package diagnostics include errors: ${errorCodes.join(', ')}.`
  }

  return null
}

export function getBuildApprovalReadinessError(extensionPackage: DiscoveredExtensionPackage) {
  const buildPlan = extensionPackage.buildPlan
  if (buildPlan?.approvalRequired !== true) {
    return OPENWAGGLE_EXTENSION.LIFECYCLE.NO_BUILD_APPROVAL_REQUIRED_ERROR
  }
  if (buildPlan.inputHash === null) {
    return OPENWAGGLE_EXTENSION.LIFECYCLE.BUILD_APPROVAL_UNAVAILABLE_ERROR
  }
  return null
}

function pinnedContentHash({
  extensionPackage,
  current,
  trusted,
  pinCurrentPackage,
}: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly current: ExtensionLifecycleState | null
  readonly trusted: boolean
  readonly pinCurrentPackage: boolean
}) {
  if (!trusted) {
    return null
  }
  return pinCurrentPackage
    ? extensionPackage.contentHash
    : (current?.contentHash ?? extensionPackage.contentHash)
}

function pinnedPackageVersion({
  extensionPackage,
  current,
  trusted,
  pinCurrentPackage,
}: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly current: ExtensionLifecycleState | null
  readonly trusted: boolean
  readonly pinCurrentPackage: boolean
}) {
  if (!trusted) {
    return null
  }
  return pinCurrentPackage
    ? (extensionPackage.manifest?.version ?? null)
    : (current?.packageVersion ?? extensionPackage.manifest?.version ?? null)
}

interface MakeLifecycleStateInput {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly current: ExtensionLifecycleState | null
  readonly enabled: boolean
  readonly trusted: boolean
  readonly pinCurrentPackage: boolean
  readonly approvedBuildPlanHash?: string | null
  readonly buildStatus?: ExtensionBuildRunStatus
  readonly buildLog?: string | null
  readonly reloadStatus?: ExtensionReloadStatus
  readonly lastReloadedAt?: number | null
  readonly diagnostics?: readonly ExtensionDiagnostic[]
}

function lifecycleGrantedCapabilities(input: MakeLifecycleStateInput) {
  if (!input.trusted) {
    return []
  }
  return input.pinCurrentPackage
    ? getExtensionGrantIds(input.extensionPackage)
    : (input.current?.grantedCapabilities ?? getExtensionGrantIds(input.extensionPackage))
}

function lifecycleApprovedBuildPlanHash(input: MakeLifecycleStateInput) {
  return input.approvedBuildPlanHash ?? input.current?.approvedBuildPlanHash ?? null
}

function lifecycleBuildStatus(input: MakeLifecycleStateInput) {
  return (
    input.buildStatus ?? input.current?.buildStatus ?? OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.NOT_RUN
  )
}

function lifecycleBuildLog(input: MakeLifecycleStateInput) {
  return input.buildLog ?? input.current?.buildLog ?? null
}

function lifecycleReloadStatus(input: MakeLifecycleStateInput) {
  return (
    input.reloadStatus ??
    input.current?.reloadStatus ??
    OPENWAGGLE_EXTENSION.RELOAD_STATUS.NOT_RELOADED
  )
}

function lifecycleLastReloadedAt(input: MakeLifecycleStateInput) {
  if (input.lastReloadedAt !== undefined) {
    return input.lastReloadedAt
  }
  return input.current?.lastReloadedAt ?? null
}

function lifecycleSdkRange(input: MakeLifecycleStateInput) {
  return input.extensionPackage.manifest?.sdk.openwaggle ?? null
}

function lifecycleSdkCompatible(input: MakeLifecycleStateInput) {
  return input.extensionPackage.sdkCompatibility?.compatible ?? false
}

function lifecycleDiagnostics(input: MakeLifecycleStateInput) {
  return input.diagnostics ?? input.extensionPackage.diagnostics
}

export function makeLifecycleState(input: MakeLifecycleStateInput): ExtensionLifecycleState {
  const now = Date.now()
  return {
    extensionId: input.extensionPackage.id,
    scope: input.extensionPackage.scope,
    enabled: input.enabled,
    trusted: input.trusted,
    grantedCapabilities: lifecycleGrantedCapabilities(input),
    contentHash: pinnedContentHash(input),
    packageVersion: pinnedPackageVersion({
      extensionPackage: input.extensionPackage,
      current: input.current,
      trusted: input.trusted,
      pinCurrentPackage: input.pinCurrentPackage,
    }),
    approvedBuildPlanHash: lifecycleApprovedBuildPlanHash(input),
    buildStatus: lifecycleBuildStatus(input),
    buildLog: lifecycleBuildLog(input),
    reloadStatus: lifecycleReloadStatus(input),
    lastReloadedAt: lifecycleLastReloadedAt(input),
    sdkRange: lifecycleSdkRange(input),
    sdkCompatible: lifecycleSdkCompatible(input),
    diagnostics: lifecycleDiagnostics(input),
    installedAt: input.current?.installedAt ?? now,
    updatedAt: now,
  }
}
