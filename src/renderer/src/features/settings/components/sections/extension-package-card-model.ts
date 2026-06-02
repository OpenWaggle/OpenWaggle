import type { ExtensionPackageSummary } from '@shared/types/extensions'

export function packageTitle(extensionPackage: ExtensionPackageSummary) {
  return extensionPackage.manifest?.name ?? extensionPackage.id
}

export function hasErrorDiagnostics(extensionPackage: ExtensionPackageSummary) {
  return extensionPackage.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
}

export function isSdkCompatible(extensionPackage: ExtensionPackageSummary) {
  return extensionPackage.sdkCompatibility?.compatible ?? false
}
