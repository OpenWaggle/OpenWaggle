import type { ExtensionPackageSummary } from '@shared/types/extensions'
import { PackageOpen } from 'lucide-react'
import { PackageActions } from './ExtensionPackageCardActions'
import {
  ExtensionDiagnostics,
  ManifestBadges,
  PackageMetadata,
} from './ExtensionPackageCardDetails'
import { PackageStatusPills, PackageTrustIcon, packageTitle } from './ExtensionPackageCardStatus'

export function ExtensionPackageCard({
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
  return (
    <div className="rounded-lg border border-border bg-[#111418] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <PackageOpen className="size-4 text-accent" />
            <h3 className="text-[15px] font-semibold text-text-primary">
              {packageTitle(extensionPackage)}
            </h3>
            <PackageStatusPills extensionPackage={extensionPackage} />
          </div>
          <div className="mt-1 truncate text-[12px] text-text-muted">
            {extensionPackage.packagePath}
          </div>
        </div>
        <PackageTrustIcon extensionPackage={extensionPackage} />
      </div>
      <PackageMetadata extensionPackage={extensionPackage} />
      <PackageActions
        extensionPackage={extensionPackage}
        busy={busy}
        projectLabel={projectLabel}
        onSetTrusted={onSetTrusted}
        onSetEnabled={onSetEnabled}
        onSetProjectDisabled={onSetProjectDisabled}
      />
      <ManifestBadges extensionPackage={extensionPackage} />
      <ExtensionDiagnostics diagnostics={extensionPackage.diagnostics} />
    </div>
  )
}
