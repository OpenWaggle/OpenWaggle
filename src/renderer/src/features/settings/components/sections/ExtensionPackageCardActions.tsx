import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionPackageSummary,
  ExtensionProjectOverrideView,
} from '@shared/types/extensions'
import { Button } from '@/shared/ui/Button'
import { hasErrorDiagnostics, isSdkCompatible, packageTitle } from './ExtensionPackageCardStatus'

function canEnablePackage(extensionPackage: ExtensionPackageSummary) {
  return (
    extensionPackage.projectOverride?.disabled !== true &&
    extensionPackage.lifecycle?.trusted === true &&
    extensionPackage.manifest !== null &&
    extensionPackage.contentHash !== null &&
    isSdkCompatible(extensionPackage) &&
    !hasErrorDiagnostics(extensionPackage)
  )
}

function disabledEnableReason(extensionPackage: ExtensionPackageSummary) {
  if (extensionPackage.projectOverride?.disabled === true) {
    return 'Enable this extension for the project before changing package enablement.'
  }
  if (extensionPackage.lifecycle?.trusted !== true) {
    return 'Trust this extension before enabling it.'
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

function trustActionLabel(trusted: boolean) {
  return trusted ? 'Untrust' : 'Trust'
}

function enableActionLabel(enabled: boolean) {
  return enabled ? 'Disable' : 'Enable'
}

function projectActionLabel(projectDisabled: boolean) {
  return projectDisabled
    ? OPENWAGGLE_EXTENSION.PROJECT_OVERRIDE.ENABLE_ACTION_LABEL
    : OPENWAGGLE_EXTENSION.PROJECT_OVERRIDE.DISABLE_ACTION_LABEL
}

function ProjectOverrideAction({
  extensionPackage,
  busy,
  onSetProjectDisabled,
}: {
  readonly extensionPackage: ExtensionPackageSummary
  readonly busy: boolean
  readonly onSetProjectDisabled: (projectPath: string, disabled: boolean) => void
}) {
  const projectOverride = extensionPackage.projectOverride
  if (!projectOverride) {
    return null
  }

  const projectDisabled = projectOverride.disabled
  const label = projectActionLabel(projectDisabled)

  return (
    <Button
      size="xs"
      variant={projectDisabled ? 'accent' : 'secondary'}
      disabled={busy}
      onClick={() => onSetProjectDisabled(projectOverride.projectPath, !projectDisabled)}
      aria-label={`${label} ${packageTitle(extensionPackage)}`}
    >
      {busy ? 'Saving…' : label}
    </Button>
  )
}

function ProjectOverrideAvailability({
  extensionPackage,
  busy,
  projectLabel,
  onSetProjectDisabled,
}: {
  readonly extensionPackage: ExtensionPackageSummary
  readonly busy: boolean
  readonly projectLabel: (projectPath: string) => string
  readonly onSetProjectDisabled: (projectPath: string, disabled: boolean) => void
}) {
  const projectOverrides: readonly ExtensionProjectOverrideView[] =
    extensionPackage.projectOverrides

  if (
    extensionPackage.scope.kind !== OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND ||
    projectOverrides.length <= 1
  ) {
    return null
  }

  return (
    <div className="mt-3 basis-full rounded-md border border-border/70 bg-bg-secondary/40 p-2">
      <div className="mb-2 text-[11px] font-medium text-text-tertiary">Project availability</div>
      <div className="flex flex-wrap gap-2">
        {projectOverrides.map((projectOverride) => {
          const projectDisabled = projectOverride.disabled
          const label = projectActionLabel(projectDisabled)
          const projectName = projectLabel(projectOverride.projectPath)
          return (
            <Button
              key={projectOverride.projectPath}
              size="xs"
              variant={projectDisabled ? 'accent' : 'secondary'}
              disabled={busy}
              onClick={() => onSetProjectDisabled(projectOverride.projectPath, !projectDisabled)}
              aria-label={`${label} ${packageTitle(extensionPackage)} for ${projectName}`}
            >
              {projectName}: {busy ? 'Saving…' : label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

export function PackageActions({
  extensionPackage,
  busy,
  projectLabel,
  onSetTrusted,
  onSetEnabled,
  onSetProjectDisabled,
}: {
  readonly extensionPackage: ExtensionPackageSummary
  readonly busy: boolean
  readonly projectLabel: (projectPath: string) => string
  readonly onSetTrusted: (trusted: boolean) => void
  readonly onSetEnabled: (enabled: boolean) => void
  readonly onSetProjectDisabled: (projectPath: string, disabled: boolean) => void
}) {
  const trusted = extensionPackage.lifecycle?.trusted === true
  const enabled = extensionPackage.lifecycle?.enabled === true
  const enableAllowed = enabled || canEnablePackage(extensionPackage)
  const title = enabled ? undefined : disabledEnableReason(extensionPackage)
  const trustLabel = trustActionLabel(trusted)
  const enableLabel = enableActionLabel(enabled)

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <Button
        size="xs"
        variant={trusted ? 'secondary' : 'accent'}
        disabled={busy}
        onClick={() => onSetTrusted(!trusted)}
        aria-label={`${trustLabel} ${packageTitle(extensionPackage)}`}
      >
        {busy ? 'Saving…' : trustLabel}
      </Button>
      <Button
        size="xs"
        variant={enabled ? 'secondary' : 'accent'}
        disabled={busy || !enableAllowed}
        onClick={() => onSetEnabled(!enabled)}
        aria-label={`${enableLabel} ${packageTitle(extensionPackage)}`}
        title={title}
      >
        {enableLabel}
      </Button>
      <ProjectOverrideAction
        extensionPackage={extensionPackage}
        busy={busy}
        onSetProjectDisabled={onSetProjectDisabled}
      />
      <ProjectOverrideAvailability
        extensionPackage={extensionPackage}
        busy={busy}
        projectLabel={projectLabel}
        onSetProjectDisabled={onSetProjectDisabled}
      />
    </div>
  )
}
