import { RouterProvider } from '@tanstack/react-router'
import { usePreferences, useSettingsSetup } from '@/hooks/useSettings'
import { router } from '@/router'

function AppLoadingView() {
  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <div className="text-text-tertiary text-sm">Loading...</div>
    </div>
  )
}

export function App() {
  useSettingsSetup()

  const { isLoaded } = usePreferences()

  if (!isLoaded) {
    return <AppLoadingView />
  }

  return <RouterProvider router={router} />
}
