import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/agents')({
  beforeLoad: () => {
    redirect({ to: '/settings/$tab', params: { tab: 'agents' }, replace: true, throw: true })
  },
})
