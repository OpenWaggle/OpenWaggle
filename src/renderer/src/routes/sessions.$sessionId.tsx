import { createFileRoute, retainSearchParams, useNavigate } from '@tanstack/react-router'
import { ChatRouteSurface } from '@/components/app/routing/ChatRouteSurface'
import { type ChatRouteSearch, parseChatRouteSearch } from './-route-search'

export const Route = createFileRoute('/sessions/$sessionId')({
  validateSearch: (search) => parseChatRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<ChatRouteSearch>(['diff', 'panel'])],
  },
  component: ChatSessionRouteView,
})

function ChatSessionRouteView() {
  const navigate = useNavigate()
  const { sessionId } = Route.useParams()
  const search = Route.useSearch()
  const diffOpen = search.panel === 'diff' || (search.diff === 1 && search.panel === undefined)
  const sessionTreeOpen = search.panel === 'session-tree'

  function setDiffOpen(open: boolean): void {
    const panel = open ? 'diff' : undefined
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId },
      search: (previous) => ({ ...previous, diff: undefined, panel }),
    })
  }

  function setSessionTreeOpen(open: boolean): void {
    const panel = open ? 'session-tree' : undefined
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId },
      search: (previous) => ({ ...previous, diff: undefined, panel }),
    })
  }

  return (
    <ChatRouteSurface
      branchId={search.branch ?? null}
      diffOpen={diffOpen}
      nodeId={search.node ?? null}
      sessionId={sessionId}
      sessionTreeOpen={sessionTreeOpen}
      onDiffOpenChange={setDiffOpen}
      onSessionTreeOpenChange={setSessionTreeOpen}
    />
  )
}
