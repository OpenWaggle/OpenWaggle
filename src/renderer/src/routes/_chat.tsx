import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_chat')({
  component: ChatRouteLayout,
})

function ChatRouteLayout() {
  return <Outlet />
}
