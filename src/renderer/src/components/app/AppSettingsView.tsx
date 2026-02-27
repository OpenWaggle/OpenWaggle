import { SettingsPage } from '@/components/settings/SettingsPage'
import { PanelErrorBoundary } from '@/components/shared/PanelErrorBoundary'
import { ToastOverlay } from './ToastOverlay'

export function AppSettingsView(): React.JSX.Element {
  return (
    <div className="flex h-full w-full overflow-hidden bg-bg">
      <PanelErrorBoundary name="Settings" className="flex flex-1 overflow-hidden">
        <SettingsPage />
      </PanelErrorBoundary>
      <ToastOverlay />
    </div>
  )
}
