import { createFileRoute } from '@tanstack/react-router'
import { AgentsRouteSurface } from './-agents-route-surface'

export const Route = createFileRoute('/agents')({
  component: AgentsRouteSurface,
})
