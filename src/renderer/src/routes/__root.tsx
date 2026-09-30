import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import type { OpenWaggleRouterContext } from '@/router-context'
import { useOpenProjectRequests, WorkspaceShell } from '@/shell'

export const Route = createRootRouteWithContext<OpenWaggleRouterContext>()({
  component: RootRouteView,
})

function RootRouteView() {
  useOpenProjectRequests()
  return (
    <WorkspaceShell>
      <Outlet />
    </WorkspaceShell>
  )
}
