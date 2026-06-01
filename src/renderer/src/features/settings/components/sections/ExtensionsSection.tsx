import { useExtensionsSectionController } from '@/features/settings/hooks/useExtensionsSectionController'
import { usePreferences } from '@/features/settings/hooks/useSettings'
import {
  ExtensionPackageCard,
  ExtensionsErrorAlert,
  ExtensionsSectionHeading,
} from './ExtensionsSectionPanels'

export function ExtensionsSection() {
  const { settings } = usePreferences()
  const controller = useExtensionsSectionController(settings.projectPath)
  const packages = controller.view?.packages ?? []
  const hasUnrecoveredError = controller.error !== null && controller.view === null

  return (
    <div className="space-y-6">
      <ExtensionsSectionHeading
        projectPath={settings.projectPath}
        loading={controller.loading}
        onRefresh={() => void controller.refresh()}
      />
      <ExtensionsErrorAlert message={controller.error} />
      {controller.loading && !controller.view ? (
        <p className="rounded-lg border border-border bg-[#111418] px-4 py-6 text-[13px] text-text-muted">
          Loading extensions…
        </p>
      ) : hasUnrecoveredError ? null : packages.length > 0 ? (
        <div className="space-y-3">
          {packages.map((extensionPackage) => (
            <ExtensionPackageCard
              key={`${extensionPackage.scope.kind}:${extensionPackage.id}`}
              extensionPackage={extensionPackage}
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
