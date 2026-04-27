import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { SettingsRouteSurface } from '@/components/app/routing/SettingsRouteSurface'
import { isSettingsTab } from './-route-search'

export const Route = createFileRoute('/settings/$tab')({
  component: SettingsTabRouteView,
})

function SettingsTabRouteView() {
  const navigate = useNavigate()
  const { tab } = Route.useParams()
  const validTab = isSettingsTab(tab) ? tab : null

  useEffect(() => {
    if (validTab === null) {
      void navigate({ to: '/settings', replace: true })
    }
  }, [navigate, validTab])

  if (validTab === null) {
    return null
  }

  return <SettingsRouteSurface tab={validTab} />
}
