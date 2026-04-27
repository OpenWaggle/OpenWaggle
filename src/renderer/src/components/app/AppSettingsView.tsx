import { SettingsPage } from '@/components/settings/SettingsPage'
import { PanelErrorBoundary } from '@/components/shared/PanelErrorBoundary'
import type { SettingsTab } from '@/stores/ui-store'

interface AppSettingsViewProps {
  readonly activeTab: SettingsTab
}

export function AppSettingsView({ activeTab }: AppSettingsViewProps) {
  return (
    <div className="absolute inset-0 z-50 flex h-full w-full overflow-hidden bg-bg">
      <PanelErrorBoundary name="Settings" className="flex flex-1 overflow-hidden">
        <SettingsPage activeTab={activeTab} />
      </PanelErrorBoundary>
    </div>
  )
}
