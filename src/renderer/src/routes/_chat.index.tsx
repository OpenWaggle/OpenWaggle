import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ChatRouteSurface } from '@/components/app/routing/ChatRouteSurface'
import { parseChatRouteSearch } from './-route-search'

export const Route = createFileRoute('/_chat/')({
  validateSearch: (search) => parseChatRouteSearch(search),
  component: ChatIndexRouteView,
})

function ChatIndexRouteView() {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const diffOpen = search.diff === 1

  function setDiffOpen(open: boolean): void {
    void navigate({
      to: '/',
      search: (previous) => ({ ...previous, diff: open ? 1 : undefined }),
    })
  }

  return (
    <ChatRouteSurface
      branchId={null}
      diffOpen={diffOpen}
      nodeId={null}
      sessionId={null}
      onDiffOpenChange={setDiffOpen}
    />
  )
}
