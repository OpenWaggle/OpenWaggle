import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from './types'

function hasErrorDiagnostics(extensionPackage: DiscoveredExtensionPackage) {
  return extensionPackage.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
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
    !hasErrorDiagnostics(input.extensionPackage)
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
