import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import type { OpenWaggleRouterContext } from '@/router-context'
import { useOpenProjectRequests, useOpenSessionLinkRequests, WorkspaceShell } from '@/shell'

export const Route = createRootRouteWithContext<OpenWaggleRouterContext>()({
  component: RootRouteView,
})

function RootRouteView() {
  useOpenProjectRequests()
  useOpenSessionLinkRequests()
  return (
    <WorkspaceShell>
      <Outlet />
    </WorkspaceShell>
  )
}
