import { useExtensionsSectionController } from '@/features/settings/hooks/useExtensionsSectionController'
import { usePreferences } from '@/features/settings/hooks/useSettings'
import { ExtensionPackageCard } from './ExtensionPackageCard'
import { ExtensionsErrorAlert, ExtensionsSectionHeading } from './ExtensionsSectionPanels'

export function ExtensionsSection() {
  const { settings } = usePreferences()
  const { view, loading, updatingExtensionId, error, refresh, setTrusted, setEnabled } =
    useExtensionsSectionController(settings.projectPath)
  const packages = view?.packages ?? []
  const hasUnrecoveredError = error !== null && view === null

  return (
    <div className="space-y-6">
      <ExtensionsSectionHeading
        projectPath={settings.projectPath}
        loading={loading}
        onRefresh={() => void refresh()}
      />
      <ExtensionsErrorAlert message={error} />
      {loading && !view ? (
        <p className="rounded-lg border border-border bg-[#111418] px-4 py-6 text-[13px] text-text-muted">
          Loading extensions…
        </p>
      ) : hasUnrecoveredError ? null : packages.length > 0 ? (
        <div className="space-y-3">
          {packages.map((extensionPackage) => (
            <ExtensionPackageCard
              key={`${extensionPackage.scope.kind}:${extensionPackage.id}`}
              extensionPackage={extensionPackage}
              busy={updatingExtensionId === extensionPackage.id}
              onSetTrusted={(trusted) => void setTrusted(extensionPackage, trusted)}
              onSetEnabled={(enabled) => void setEnabled(extensionPackage, enabled)}
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
