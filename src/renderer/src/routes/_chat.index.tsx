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
  const diffOpen = search.panel === 'diff' || (search.diff === 1 && search.panel === undefined)
  const sessionTreeOpen = search.panel === 'session-tree'

  function setDiffOpen(open: boolean): void {
    const panel = open ? 'diff' : undefined
    void navigate({
      to: '/',
      search: { diff: undefined, panel },
    })
  }

  function setSessionTreeOpen(open: boolean): void {
    const panel = open ? 'session-tree' : undefined
    void navigate({
      to: '/',
      search: { diff: undefined, panel },
    })
  }

  return (
    <ChatRouteSurface
      branchId={null}
      diffOpen={diffOpen}
      nodeId={null}
      sessionId={null}
      sessionTreeOpen={sessionTreeOpen}
      onDiffOpenChange={setDiffOpen}
      onSessionTreeOpenChange={setSessionTreeOpen}
    />
  )
}
