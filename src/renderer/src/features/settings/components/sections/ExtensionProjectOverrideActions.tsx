import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionPackageSummary,
  ExtensionProjectOverrideView,
} from '@shared/types/extensions'
import { Button } from '@/shared/ui/Button'
import { packageTitle } from './extension-package-card-model'

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

export function ProjectOverrideActions({
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
  return (
    <>
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
    </>
  )
}
