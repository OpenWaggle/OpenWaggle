import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from './types'

function hasErrorDiagnostics(extensionPackage: DiscoveredExtensionPackage) {
  return extensionPackage.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
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
    input.lifecycle?.approvedBuildPlanHash === input.extensionPackage.buildPlan.inputHash
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
    isExtensionCurrentTrustPin({
      extensionPackage: input.extensionPackage,
      lifecycle: input.lifecycle,
    }) &&
    input.projectOverride?.disabled !== true
  )
}
