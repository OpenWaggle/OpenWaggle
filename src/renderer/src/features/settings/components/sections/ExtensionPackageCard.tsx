import type { ExtensionPackageSummary } from '@shared/types/extensions'
import { PackageOpen } from 'lucide-react'
import { formatDisplayPath } from '@/shared/lib/display-path'
import { tildifyPath } from '@/shared/lib/tildify-path'
import { ExtensionDiagnostics } from './ExtensionDiagnostics'
import { ManifestBadges } from './ExtensionManifestBadges'
import { PackageActions } from './ExtensionPackageCardActions'
import { PackageStatusPills, PackageTrustIcon } from './ExtensionPackageCardStatus'
import { PackageMetadata } from './ExtensionPackageMetadata'
import { ExtensionPackageRequirements } from './ExtensionPackageRequirements'
import type { PackageContributionSummary } from './extension-contribution-summary-model'
import {
  type ExtensionPackageCardActions,
  packageTitle,
  visiblePackageDiagnostics,
} from './extension-package-card-model'

export function ExtensionPackageCard({
  extensionPackage,
  contributionSummary,
  busy,
  projectLabel,
  actions,
}: {
  readonly extensionPackage: ExtensionPackageSummary
  readonly contributionSummary: PackageContributionSummary | null
  readonly busy: boolean
  readonly projectLabel: (projectPath: string) => string
  readonly actions: ExtensionPackageCardActions
}) {
  const packagePath =
    extensionPackage.scope.kind === 'project'
      ? formatDisplayPath(extensionPackage.packagePath, [extensionPackage.scope.projectPath])
      : tildifyPath(extensionPackage.packagePath)
  const displayRoots =
    extensionPackage.scope.kind === 'project' && extensionPackage.scope.projectPath
      ? [extensionPackage.scope.projectPath]
      : []
  return (
    <div className="rounded-lg border border-border bg-bg p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <PackageOpen className="size-4 text-accent" />
            <h3 className="text-base font-semibold text-text-primary">
              {packageTitle(extensionPackage)}
            </h3>
            <PackageStatusPills extensionPackage={extensionPackage} />
          </div>
          <div className="mt-1 truncate text-xs text-text-muted">{packagePath}</div>
        </div>
        <PackageTrustIcon extensionPackage={extensionPackage} />
      </div>
      <PackageMetadata
        extensionPackage={extensionPackage}
        contributionSummary={contributionSummary}
        displayRoots={displayRoots}
      />
      <ExtensionPackageRequirements
        requirements={extensionPackage.requirements}
        displayRoots={displayRoots}
      />
      <PackageActions
        extensionPackage={extensionPackage}
        busy={busy}
        projectLabel={projectLabel}
        actions={actions}
      />
      <ManifestBadges extensionPackage={extensionPackage} />
      <ExtensionDiagnostics
        diagnostics={visiblePackageDiagnostics(extensionPackage)}
        displayRoots={displayRoots}
      />
    </div>
  )
}
