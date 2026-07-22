import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from './types'

function hasErrorDiagnostics(extensionPackage: DiscoveredExtensionPackage) {
  return extensionPackage.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
}

function uniqueGrantIds(grantIds: readonly string[]) {
  const uniqueIds: string[] = []
  const seenIds = new Set<string>()
  for (const grantId of grantIds) {
    if (!seenIds.has(grantId)) {
      seenIds.add(grantId)
      uniqueIds.push(grantId)
    }
  }
  return uniqueIds
}

export function getExtensionGrantIds(extensionPackage: DiscoveredExtensionPackage) {
  const manifest = extensionPackage.manifest
  if (!manifest) {
    return []
  }

  const grantIds = manifest.capabilities?.map((capability) => capability.id) ?? []

  if (manifest.trusted?.main !== undefined) {
    grantIds.push(OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_MAIN)
  }
  if (manifest.trusted?.renderer !== undefined) {
    grantIds.push(OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_RENDERER)
  }
  if (manifest.network?.origins !== undefined && manifest.network.origins.length > 0) {
    grantIds.push(OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.NETWORK)
  }
  if (extensionPackage.buildPlan?.approvalRequired === true) {
    grantIds.push(OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.LOCAL_BUILD)
  }

  return uniqueGrantIds(grantIds)
}

export function getMissingExtensionGrantIds(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState
}) {
  const requiredGrantIds = getExtensionGrantIds(input.extensionPackage)
  const grantedCapabilities = new Set(input.lifecycle.grantedCapabilities)
  return requiredGrantIds.filter((grantId) => !grantedCapabilities.has(grantId))
}

function hasRequiredGrants(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState
}) {
  return getMissingExtensionGrantIds(input).length === 0
}

export function isExtensionBuildPlanApproved(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState | null
}) {
  if (input.extensionPackage.buildPlan?.approvalRequired !== true) {
    return true
  }

  return (
    input.extensionPackage.buildPlan.inputHash !== null &&
    input.lifecycle?.approvedBuildPlanHash === input.extensionPackage.buildPlan.inputHash &&
    input.lifecycle.buildStatus === OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.SUCCEEDED
  )
}

export function isExtensionCurrentTrustPin(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState
}) {
  return (
    input.lifecycle.trusted &&
    input.extensionPackage.contentHash !== null &&
    input.lifecycle.contentHash === input.extensionPackage.contentHash &&
    input.extensionPackage.sdkCompatibility?.compatible === true &&
    isExtensionBuildPlanApproved(input) &&
    hasRequiredGrants(input) &&
    !hasErrorDiagnostics(input.extensionPackage)
  )
}

export function isExtensionUpdateAvailable(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState | null
}) {
  return (
    input.lifecycle?.trusted === true &&
    input.lifecycle.contentHash !== null &&
    input.extensionPackage.contentHash !== null &&
    input.lifecycle.contentHash !== input.extensionPackage.contentHash
  )
}

function isExtensionReloaded(lifecycle: ExtensionLifecycleState) {
  return lifecycle.reloadStatus === OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED
}

export function isExtensionRuntimeEnabled(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState | null
  readonly projectOverride: { readonly disabled: boolean } | null
}) {
  if (!input.lifecycle) {
    return false
  }

  return (
    input.lifecycle.enabled &&
    isExtensionReloaded(input.lifecycle) &&
    isExtensionCurrentTrustPin({
      extensionPackage: input.extensionPackage,
      lifecycle: input.lifecycle,
    }) &&
    input.projectOverride?.disabled !== true
  )
}
