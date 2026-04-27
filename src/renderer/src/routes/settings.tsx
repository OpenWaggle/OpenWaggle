import { createFileRoute } from '@tanstack/react-router'
import { SettingsRouteSurface } from '@/components/app/routing/SettingsRouteSurface'

export const Route = createFileRoute('/settings')({
  component: SettingsRouteView,
})

function SettingsRouteView() {
  return <SettingsRouteSurface tab="general" />
}
