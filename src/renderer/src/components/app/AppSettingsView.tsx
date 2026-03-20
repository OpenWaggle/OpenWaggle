import { SettingsPage } from '@/components/settings/SettingsPage'
import { PanelErrorBoundary } from '@/components/shared/PanelErrorBoundary'

export function AppSettingsView() {
  return (
    <div className="absolute inset-0 z-50 flex h-full w-full overflow-hidden bg-bg">
      <PanelErrorBoundary name="Settings" className="flex flex-1 overflow-hidden">
        <SettingsPage />
      </PanelErrorBoundary>
    </div>
  )
}
