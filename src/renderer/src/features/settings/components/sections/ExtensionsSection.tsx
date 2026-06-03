import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryView,
  ExtensionPackageSummary,
} from '@shared/types/extensions'
import { useSessions } from '@/features/sessions/hooks'
import { useExtensionsSectionController } from '@/features/settings/hooks/useExtensionsSectionController'
import { usePreferences } from '@/features/settings/hooks/useSettings'
import { projectName } from '@/shared/lib/format'
import {
  ExtensionContributionSummary,
  type PackageContributionSummary,
  summarizePackageContributions,
} from './ExtensionContributionSummary'
import { ExtensionPackageCard } from './ExtensionPackageCard'
import { ExtensionsErrorAlert, ExtensionsSectionHeading } from './ExtensionsSectionPanels'
import type { ExtensionPackageCardActions } from './extension-package-card-model'

interface ExtensionScopeGroup {
  readonly key: string
  readonly title: string
  readonly subtitle: string
  readonly packages: readonly ExtensionPackageSummary[]
}

interface ExtensionMutationHandlers {
  readonly setTrusted: (extensionPackage: ExtensionPackageSummary, trusted: boolean) => void
  readonly setEnabled: (extensionPackage: ExtensionPackageSummary, enabled: boolean) => void
  readonly setProjectDisabled: (
    extensionPackage: ExtensionPackageSummary,
    projectPath: string,
    disabled: boolean,
  ) => void
  readonly acceptUpdate: (extensionPackage: ExtensionPackageSummary) => void
  readonly approveBuild: (extensionPackage: ExtensionPackageSummary) => void
  readonly reload: (extensionPackage: ExtensionPackageSummary) => void
}

function packageActions(
  extensionPackage: ExtensionPackageSummary,
  handlers: ExtensionMutationHandlers,
): ExtensionPackageCardActions {
  return {
    onSetTrusted: (trusted) => handlers.setTrusted(extensionPackage, trusted),
    onSetEnabled: (enabled) => handlers.setEnabled(extensionPackage, enabled),
    onSetProjectDisabled: (projectPath, disabled) =>
      handlers.setProjectDisabled(extensionPackage, projectPath, disabled),
    onAcceptUpdate: () => handlers.acceptUpdate(extensionPackage),
    onApproveBuild: () => handlers.approveBuild(extensionPackage),
    onReload: () => handlers.reload(extensionPackage),
  }
}

function addProjectPath(projectPaths: string[], projectPath: string | null) {
  const trimmed = projectPath?.trim()
  if (trimmed && !projectPaths.includes(trimmed)) {
    projectPaths.push(trimmed)
  }
}

function buildProjectPaths({
  selectedProjectPath,
  recentProjects,
  sessionProjectPaths,
}: {
  readonly selectedProjectPath: string | null
  readonly recentProjects: readonly string[]
  readonly sessionProjectPaths: readonly (string | null)[]
}) {
  const projectPaths: string[] = []
  addProjectPath(projectPaths, selectedProjectPath)
  for (const projectPath of recentProjects) {
    addProjectPath(projectPaths, projectPath)
  }
  for (const projectPath of sessionProjectPaths) {
    addProjectPath(projectPaths, projectPath)
  }
  return projectPaths
}

function packageKey(extensionPackage: ExtensionPackageSummary) {
  const scopeId =
    extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND
      ? extensionPackage.scope.projectPath
      : OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_ID
  return `${extensionPackage.scope.kind}:${scopeId}:${extensionPackage.id}`
}

function packagesForProject(packages: readonly ExtensionPackageSummary[], projectPath: string) {
  return packages.filter(
    (extensionPackage) =>
      extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND &&
      extensionPackage.scope.projectPath === projectPath,
  )
}

function packageContributionSummary(
  registry: ExtensionContributionRegistryView | null,
  extensionPackage: ExtensionPackageSummary,
): PackageContributionSummary | null {
  if (!registry) {
    return null
  }

  const entries = registry.entries.filter(
    (entry) =>
      entry.extensionId === extensionPackage.id &&
      entry.packagePath === extensionPackage.packagePath,
  )
  return entries.length > 0 ? summarizePackageContributions(entries) : null
}

function buildScopeGroups({
  packages,
  projectPaths,
  projectLabel,
}: {
  readonly packages: readonly ExtensionPackageSummary[]
  readonly projectPaths: readonly string[]
  readonly projectLabel: (projectPath: string) => string
}): readonly ExtensionScopeGroup[] {
  const globalPackages = packages.filter(
    (extensionPackage) => extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND,
  )
  const projectGroups = projectPaths.map((projectPath) => ({
    key: `project:${projectPath}`,
    title: projectLabel(projectPath),
    subtitle: projectPath,
    packages: packagesForProject(packages, projectPath),
  }))

  return [
    {
      key: 'global',
      title: 'Global scope',
      subtitle: 'Available to every project unless a project opts out.',
      packages: globalPackages,
    },
    ...projectGroups,
  ]
}

function ExtensionScopeSection({
  group,
  contributionRegistry,
  busyExtensionId,
  projectLabel,
  handlers,
}: {
  readonly group: ExtensionScopeGroup
  readonly contributionRegistry: ExtensionContributionRegistryView | null
  readonly busyExtensionId: string | null
  readonly projectLabel: (projectPath: string) => string
  readonly handlers: ExtensionMutationHandlers
}) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-bg-secondary/30 p-3">
      <div>
        <h3 className="text-[13px] font-semibold text-text-secondary">{group.title}</h3>
        <p className="mt-0.5 text-[11px] text-text-muted">{group.subtitle}</p>
      </div>
      {group.packages.length > 0 ? (
        <div className="space-y-3">
          {group.packages.map((extensionPackage) => (
            <ExtensionPackageCard
              key={packageKey(extensionPackage)}
              extensionPackage={extensionPackage}
              contributionSummary={packageContributionSummary(
                contributionRegistry,
                extensionPackage,
              )}
              busy={busyExtensionId === extensionPackage.id}
              projectLabel={projectLabel}
              actions={packageActions(extensionPackage, handlers)}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-border/70 bg-[#111418] p-4 text-[13px] text-text-muted">
          No extension packages in this scope.
        </p>
      )}
    </section>
  )
}

export function ExtensionsSection() {
  const { settings } = usePreferences()
  const { sessions } = useSessions()
  const requestedProjectPaths = buildProjectPaths({
    selectedProjectPath: settings.projectPath,
    recentProjects: settings.recentProjects,
    sessionProjectPaths: sessions.map((session) => session.projectPath),
  })
  function projectLabel(projectPath: string) {
    return settings.projectDisplayNames[projectPath]?.trim() || projectName(projectPath)
  }

  const {
    view,
    contributionRegistry,
    loading,
    updatingExtensionId,
    error,
    refresh,
    setTrusted,
    setEnabled,
    setProjectDisabled,
    acceptUpdate,
    approveBuild,
    reload,
  } = useExtensionsSectionController(requestedProjectPaths)
  const packages = view?.packages ?? []
  const projectPaths = view?.projectPaths ?? requestedProjectPaths
  const scopeGroups = buildScopeGroups({ packages, projectPaths, projectLabel })
  const hasUnrecoveredError = error !== null && view === null
  const handlers: ExtensionMutationHandlers = {
    setTrusted: (extensionPackage, trusted) => void setTrusted(extensionPackage, trusted),
    setEnabled: (extensionPackage, enabled) => void setEnabled(extensionPackage, enabled),
    setProjectDisabled: (extensionPackage, projectPath, disabled) =>
      void setProjectDisabled(extensionPackage, projectPath, disabled),
    acceptUpdate: (extensionPackage) => void acceptUpdate(extensionPackage),
    approveBuild: (extensionPackage) => void approveBuild(extensionPackage),
    reload: (extensionPackage) => void reload(extensionPackage),
  }

  return (
    <div className="space-y-6">
      <ExtensionsSectionHeading
        projectCount={projectPaths.length}
        loading={loading}
        onRefresh={() => void refresh()}
      />
      <ExtensionsErrorAlert message={error} />
      {view ? (
        <ExtensionContributionSummary registry={contributionRegistry} packages={packages} />
      ) : null}
      {loading && !view ? (
        <p className="rounded-lg border border-border bg-[#111418] px-4 py-6 text-[13px] text-text-muted">
          Loading extensions…
        </p>
      ) : hasUnrecoveredError ? null : scopeGroups.length > 0 ? (
        <div className="space-y-3">
          {scopeGroups.map((group) => (
            <ExtensionScopeSection
              key={group.key}
              group={group}
              contributionRegistry={contributionRegistry}
              busyExtensionId={updatingExtensionId}
              projectLabel={projectLabel}
              handlers={handlers}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-border bg-[#111418] px-4 py-6 text-[13px] text-text-muted">
          No extension packages discovered.
        </p>
      )}
    </div>
  )
}
