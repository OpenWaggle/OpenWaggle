import { SettingsPage } from '@/features/settings/components/SettingsPage'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import type { SettingsTab } from '@/shell/ui-store'

interface AppSettingsViewProps {
  readonly activeTab: SettingsTab
}

export function AppSettingsView({ activeTab }: AppSettingsViewProps) {
  return (
    <div className="absolute inset-0 z-50 flex size-full overflow-hidden bg-bg">
      <PanelErrorBoundary name="Settings" className="flex flex-1 overflow-hidden">
        <SettingsPage activeTab={activeTab} />
      </PanelErrorBoundary>
    </div>
  )
}
