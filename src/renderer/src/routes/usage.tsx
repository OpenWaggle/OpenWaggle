import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useChat } from '@/features/chat/hooks'
import { UsageCostPage, useUsageCostView } from '@/features/usage-cost'

export const Route = createFileRoute('/usage')({
  component: UsageCostRouteView,
})

function UsageCostRouteView() {
  const state = useUsageCostView()
  const navigate = useNavigate()
  const { activeSessionId } = useChat()

  // Same destination as Settings' "Back to app": the active session, else the start view.
  function navigateBackToApp() {
    if (activeSessionId) {
      void navigate({
        to: '/sessions/$sessionId',
        params: { sessionId: String(activeSessionId) },
      })
      return
    }
    void navigate({ to: '/' })
  }

  return <UsageCostPage state={state} onBack={navigateBackToApp} />
}
