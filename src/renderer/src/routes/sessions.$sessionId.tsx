import { createFileRoute, retainSearchParams, useNavigate } from '@tanstack/react-router'
import { ChatRouteSurface } from '@/components/app/routing/ChatRouteSurface'
import { type ChatRouteSearch, parseChatRouteSearch } from './-route-search'

export const Route = createFileRoute('/sessions/$sessionId')({
  validateSearch: (search) => parseChatRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<ChatRouteSearch>(['branch', 'node', 'diff'])],
  },
  component: ChatSessionRouteView,
})

function ChatSessionRouteView() {
  const navigate = useNavigate()
  const { sessionId } = Route.useParams()
  const search = Route.useSearch()
  const diffOpen = search.diff === 1

  function setDiffOpen(open: boolean): void {
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId },
      search: (previous) => ({ ...previous, diff: open ? 1 : undefined }),
    })
  }

  return (
    <ChatRouteSurface
      branchId={search.branch ?? null}
      diffOpen={diffOpen}
      nodeId={search.node ?? null}
      sessionId={sessionId}
      onDiffOpenChange={setDiffOpen}
    />
  )
}
