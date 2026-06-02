import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionPackageSummary } from '@shared/types/extensions'
import { Button } from '@/shared/ui/Button'
import { ProjectOverrideActions } from './ExtensionProjectOverrideActions'
import {
  type ExtensionPackageCardActions,
  hasErrorDiagnostics,
  isBuildPlanApproved,
  isSdkCompatible,
  packageTitle,
} from './extension-package-card-model'

function canEnablePackage(extensionPackage: ExtensionPackageSummary) {
  return (
    extensionPackage.projectOverride?.disabled !== true &&
    extensionPackage.lifecycle?.trusted === true &&
    extensionPackage.manifest !== null &&
    extensionPackage.contentHash !== null &&
    isSdkCompatible(extensionPackage) &&
    isBuildPlanApproved(extensionPackage) &&
    !hasErrorDiagnostics(extensionPackage)
  )
}

function canApproveUpdate(extensionPackage: ExtensionPackageSummary) {
  return (
    extensionPackage.lifecycle?.updateAvailable === true &&
    extensionPackage.manifest !== null &&
    extensionPackage.contentHash !== null &&
    isSdkCompatible(extensionPackage) &&
    isBuildPlanApproved(extensionPackage) &&
    !hasErrorDiagnostics(extensionPackage)
  )
}

function canApproveBuild(extensionPackage: ExtensionPackageSummary) {
  return (
    extensionPackage.buildPlan?.approvalRequired === true &&
    extensionPackage.buildPlan.approved === false &&
    extensionPackage.buildPlan.inputHash !== null
  )
}

function disabledEnableReason(extensionPackage: ExtensionPackageSummary) {
  if (extensionPackage.projectOverride?.disabled === true) {
    return 'Enable this extension for the project before changing package enablement.'
  }
  if (extensionPackage.lifecycle?.updateAvailable === true) {
    return 'Approve this extension update before enabling it.'
  }
  if (extensionPackage.lifecycle?.trusted !== true) {
    return 'Trust this extension before enabling it.'
  }
  if (!isBuildPlanApproved(extensionPackage)) {
    return 'Approve and run this extension build before enabling it.'
  }
  if (extensionPackage.manifest === null) {
    return 'Cannot enable an extension with an invalid manifest.'
  }
  if (extensionPackage.contentHash === null) {
    return 'Cannot enable an extension without a content hash.'
  }
  if (!isSdkCompatible(extensionPackage)) {
    return 'Cannot enable an extension with an incompatible SDK range.'
  }
  if (hasErrorDiagnostics(extensionPackage)) {
    return 'Cannot enable an extension with error diagnostics.'
  }
  return undefined
}

function disabledUpdateReason(extensionPackage: ExtensionPackageSummary) {
  if (extensionPackage.manifest === null) {
    return 'Cannot approve an extension update with an invalid manifest.'
  }
  if (extensionPackage.contentHash === null) {
    return 'Cannot approve an extension update without a content hash.'
  }
  if (!isSdkCompatible(extensionPackage)) {
    return 'Cannot approve an extension update with an incompatible SDK range.'
  }
  if (!isBuildPlanApproved(extensionPackage)) {
    return 'Approve and run this extension build before approving the update.'
  }
  if (hasErrorDiagnostics(extensionPackage)) {
    return 'Cannot approve an extension update with error diagnostics.'
  }
  return undefined
}

function disabledBuildReason(extensionPackage: ExtensionPackageSummary) {
  if (extensionPackage.buildPlan?.approvalRequired !== true) {
    return 'This extension does not require local build approval.'
  }
  if (extensionPackage.buildPlan.inputHash === null) {
    return 'Cannot approve the build plan until source files are valid.'
  }
  return undefined
}

function trustActionLabel(trusted: boolean) {
  return trusted ? 'Untrust' : 'Trust'
}

function trustActionValue({
  trusted,
  updateAvailable,
}: {
  readonly trusted: boolean
  readonly updateAvailable: boolean
}) {
  return updateAvailable ? false : !trusted
}

function enableActionLabel(enabled: boolean) {
  return enabled ? 'Disable' : 'Enable'
}

function ReloadAction({
  extensionPackage,
  busy,
  enabled,
  onReload,
}: {
  readonly extensionPackage: ExtensionPackageSummary
  readonly busy: boolean
  readonly enabled: boolean
  readonly onReload: () => void
}) {
  if (!enabled) {
    return null
  }

  const reloadLabel = OPENWAGGLE_EXTENSION.LIFECYCLE.RELOAD_ACTION_LABEL
  return (
    <Button
      size="xs"
      variant="secondary"
      disabled={busy}
      onClick={onReload}
      aria-label={`${reloadLabel} ${packageTitle(extensionPackage)}`}
    >
      {busy ? 'Saving…' : reloadLabel}
    </Button>
  )
}

function TrustAction({
  extensionPackage,
  busy,
  trusted,
  updateAvailable,
  onSetTrusted,
}: {
  readonly extensionPackage: ExtensionPackageSummary
  readonly busy: boolean
  readonly trusted: boolean
  readonly updateAvailable: boolean
  readonly onSetTrusted: (trusted: boolean) => void
}) {
  const trustLabel = updateAvailable ? 'Untrust' : trustActionLabel(trusted)
  return (
    <Button
      size="xs"
      variant={trusted || updateAvailable ? 'secondary' : 'accent'}
      disabled={busy}
      onClick={() => onSetTrusted(trustActionValue({ trusted, updateAvailable }))}
      aria-label={`${trustLabel} ${packageTitle(extensionPackage)}`}
    >
      {busy ? 'Saving…' : trustLabel}
    </Button>
  )
}

function UpdateAction({
  extensionPackage,
  busy,
  updateAvailable,
  onAcceptUpdate,
}: {
  readonly extensionPackage: ExtensionPackageSummary
  readonly busy: boolean
  readonly updateAvailable: boolean
  readonly onAcceptUpdate: () => void
}) {
  if (!updateAvailable) {
    return null
  }

  const approveUpdateLabel = OPENWAGGLE_EXTENSION.LIFECYCLE.APPROVE_UPDATE_ACTION_LABEL
  return (
    <Button
      size="xs"
      variant="accent"
      disabled={busy || !canApproveUpdate(extensionPackage)}
      onClick={onAcceptUpdate}
      aria-label={`${approveUpdateLabel} ${packageTitle(extensionPackage)}`}
      title={disabledUpdateReason(extensionPackage)}
    >
      {busy ? 'Saving…' : approveUpdateLabel}
    </Button>
  )
}

function BuildApprovalAction({
  extensionPackage,
  busy,
  onApproveBuild,
}: {
  readonly extensionPackage: ExtensionPackageSummary
  readonly busy: boolean
  readonly onApproveBuild: () => void
}) {
  const visible =
    extensionPackage.buildPlan?.approvalRequired === true && !extensionPackage.buildPlan.approved
  if (!visible) {
    return null
  }

  const approveBuildLabel = OPENWAGGLE_EXTENSION.LIFECYCLE.APPROVE_BUILD_ACTION_LABEL
  return (
    <Button
      size="xs"
      variant="accent"
      disabled={busy || !canApproveBuild(extensionPackage)}
      onClick={onApproveBuild}
      aria-label={`${approveBuildLabel} ${packageTitle(extensionPackage)}`}
      title={disabledBuildReason(extensionPackage)}
    >
      {busy ? 'Saving…' : approveBuildLabel}
    </Button>
  )
}

function EnableAction({
  extensionPackage,
  busy,
  enabled,
  onSetEnabled,
}: {
  readonly extensionPackage: ExtensionPackageSummary
  readonly busy: boolean
  readonly enabled: boolean
  readonly onSetEnabled: (enabled: boolean) => void
}) {
  const enableAllowed = enabled || canEnablePackage(extensionPackage)
  const enableLabel = enableActionLabel(enabled)
  return (
    <Button
      size="xs"
      variant={enabled ? 'secondary' : 'accent'}
      disabled={busy || !enableAllowed}
      onClick={() => onSetEnabled(!enabled)}
      aria-label={`${enableLabel} ${packageTitle(extensionPackage)}`}
      title={enabled ? undefined : disabledEnableReason(extensionPackage)}
    >
      {enableLabel}
    </Button>
  )
}

export function PackageActions({
  extensionPackage,
  busy,
  projectLabel,
  actions,
}: {
  readonly extensionPackage: ExtensionPackageSummary
  readonly busy: boolean
  readonly projectLabel: (projectPath: string) => string
  readonly actions: ExtensionPackageCardActions
}) {
  const trusted = extensionPackage.lifecycle?.trusted === true
  const enabled = extensionPackage.lifecycle?.enabled === true
  const updateAvailable = extensionPackage.lifecycle?.updateAvailable === true

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <TrustAction
        extensionPackage={extensionPackage}
        busy={busy}
        trusted={trusted}
        updateAvailable={updateAvailable}
        onSetTrusted={actions.onSetTrusted}
      />
      <UpdateAction
        extensionPackage={extensionPackage}
        busy={busy}
        updateAvailable={updateAvailable}
        onAcceptUpdate={actions.onAcceptUpdate}
      />
      <BuildApprovalAction
        extensionPackage={extensionPackage}
        busy={busy}
        onApproveBuild={actions.onApproveBuild}
      />
      <EnableAction
        extensionPackage={extensionPackage}
        busy={busy}
        enabled={enabled}
        onSetEnabled={actions.onSetEnabled}
      />
      <ReloadAction
        extensionPackage={extensionPackage}
        busy={busy}
        enabled={enabled}
        onReload={actions.onReload}
      />
      <ProjectOverrideActions
        extensionPackage={extensionPackage}
        busy={busy}
        projectLabel={projectLabel}
        onSetProjectDisabled={actions.onSetProjectDisabled}
      />
    </div>
  )
}
