import { createFileRoute } from '@tanstack/react-router'
import { useNavigateBackToApp } from '@/features/chat/hooks'
import { UsageCostPage, useUsageCostView } from '@/features/usage-cost'

export const Route = createFileRoute('/usage')({
  component: UsageCostRouteView,
})

function UsageCostRouteView() {
  const state = useUsageCostView()
  const navigateBackToApp = useNavigateBackToApp()
  return <UsageCostPage state={state} onBack={navigateBackToApp} />
}
