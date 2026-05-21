import { createFileRoute } from '@tanstack/react-router'
import { SettingsRouteSurface } from './-settings-route-surface'

export const Route = createFileRoute('/settings')({
  component: SettingsRouteView,
})

function SettingsRouteView() {
  return <SettingsRouteSurface tab="general" />
}
