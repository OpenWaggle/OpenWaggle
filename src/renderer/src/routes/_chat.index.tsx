import { createFileRoute } from '@tanstack/react-router'
import { ChatIndexRouteView } from './-chat-index-route-view'
import { parseChatRouteSearch } from './-route-search'

export const Route = createFileRoute('/_chat/')({
  validateSearch: (search) => parseChatRouteSearch(search),
  component: ChatIndexRouteView,
})
