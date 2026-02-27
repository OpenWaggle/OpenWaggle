import { AppSettingsView } from '@/components/app/AppSettingsView'
import { WorkspaceShell } from '@/components/app/workspace/WorkspaceShell'
import { usePreferences, useSettingsSetup } from '@/hooks/useSettings'
import { useUIStore } from '@/stores/ui-store'

function AppLoadingView(): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <div className="text-text-tertiary text-sm">Loading...</div>
    </div>
  )
}

export function App(): React.JSX.Element {
  const activeView = useUIStore((s) => s.activeView)

  useSettingsSetup()

  const { isLoaded } = usePreferences()

  if (!isLoaded) {
    return <AppLoadingView />
  }

  if (activeView === 'settings') {
    return <AppSettingsView />
  }

  return <WorkspaceShell />
}
