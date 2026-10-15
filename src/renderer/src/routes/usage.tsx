import { createFileRoute } from '@tanstack/react-router'
import { UsageCostPage, useUsageCostView } from '@/features/usage-cost'

export const Route = createFileRoute('/usage')({
  component: UsageCostRouteView,
})

function UsageCostRouteView() {
  const state = useUsageCostView()
  return <UsageCostPage state={state} />
}
