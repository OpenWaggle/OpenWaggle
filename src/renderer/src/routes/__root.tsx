import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import type { OpenWaggleRouterContext } from '@/router-context'
import { WorkspaceShell } from '@/shell'

export const Route = createRootRouteWithContext<OpenWaggleRouterContext>()({
  component: RootRouteView,
})

function RootRouteView() {
  return (
    <WorkspaceShell>
      <Outlet />
    </WorkspaceShell>
  )
}
