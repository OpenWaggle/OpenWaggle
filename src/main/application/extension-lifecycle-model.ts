import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionAcceptUpdateInput,
  ExtensionLifecycleMutationTarget,
  ExtensionSetEnabledInput,
  ExtensionSetProjectDisabledInput,
  ExtensionSetTrustedInput,
} from '@shared/types/extensions'
import type {
  DiscoveredExtensionPackage,
  ExtensionLifecycleKey,
  ExtensionLifecycleState,
  ExtensionPackageScope,
  ExtensionProjectOverrideKey,
} from '../extensions/types'

export type LifecycleMutationInput =
  | ExtensionSetTrustedInput
  | ExtensionSetEnabledInput
  | ExtensionAcceptUpdateInput

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
  return extensionPackage.diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.code)
}

export function getLifecycleReadinessError(
  extensionPackage: DiscoveredExtensionPackage,
  action: 'trust' | 'enable',
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

  const errorCodes = getPackageErrorCodes(extensionPackage)
  if (errorCodes.length > 0) {
    return `Cannot ${action} "${extensionPackage.id}" because package diagnostics include errors: ${errorCodes.join(', ')}.`
  }

  return null
}

function getGrantedCapabilities(extensionPackage: DiscoveredExtensionPackage) {
  return extensionPackage.manifest?.capabilities?.map((capability) => capability.id) ?? []
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

export function makeLifecycleState({
  extensionPackage,
  current,
  enabled,
  trusted,
  pinCurrentPackage,
}: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly current: ExtensionLifecycleState | null
  readonly enabled: boolean
  readonly trusted: boolean
  readonly pinCurrentPackage: boolean
}): ExtensionLifecycleState {
  const now = Date.now()
  return {
    extensionId: extensionPackage.id,
    scope: extensionPackage.scope,
    enabled,
    trusted,
    grantedCapabilities: trusted ? getGrantedCapabilities(extensionPackage) : [],
    contentHash: pinnedContentHash({ extensionPackage, current, trusted, pinCurrentPackage }),
    packageVersion: pinnedPackageVersion({
      extensionPackage,
      current,
      trusted,
      pinCurrentPackage,
    }),
    sdkRange: extensionPackage.manifest?.sdk.openwaggle ?? null,
    sdkCompatible: extensionPackage.sdkCompatibility?.compatible ?? false,
    diagnostics: extensionPackage.diagnostics,
    installedAt: current?.installedAt ?? now,
    updatedAt: now,
  }
}
