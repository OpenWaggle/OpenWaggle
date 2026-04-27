import { createRootRoute, Outlet } from '@tanstack/react-router'
import { WorkspaceShell } from '@/components/app/workspace/WorkspaceShell'

export const Route = createRootRoute({
  component: RootRouteView,
})

function RootRouteView() {
  return (
    <WorkspaceShell>
      <Outlet />
    </WorkspaceShell>
  )
}
