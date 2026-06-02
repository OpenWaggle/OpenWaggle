import type { ExtensionPackageSummary } from '@shared/types/extensions'

export interface ExtensionPackageCardActions {
  readonly onSetTrusted: (trusted: boolean) => void
  readonly onSetEnabled: (enabled: boolean) => void
  readonly onSetProjectDisabled: (projectPath: string, disabled: boolean) => void
  readonly onAcceptUpdate: () => void
  readonly onApproveBuild: () => void
  readonly onReload: () => void
}

export function packageTitle(extensionPackage: ExtensionPackageSummary) {
  return extensionPackage.manifest?.name ?? extensionPackage.id
}

export function hasErrorDiagnostics(extensionPackage: ExtensionPackageSummary) {
  return extensionPackage.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
}

export function isSdkCompatible(extensionPackage: ExtensionPackageSummary) {
  return extensionPackage.sdkCompatibility?.compatible ?? false
}

export function isBuildPlanApproved(extensionPackage: ExtensionPackageSummary) {
  return (
    extensionPackage.buildPlan?.approvalRequired !== true || extensionPackage.buildPlan.approved
  )
}
