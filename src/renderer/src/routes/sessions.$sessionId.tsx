import { createFileRoute, retainSearchParams } from '@tanstack/react-router'
import { ChatSessionRouteView } from './-chat-route-views'
import { type ChatRouteSearch, parseChatRouteSearch } from './-route-search'

export const Route = createFileRoute('/sessions/$sessionId')({
  validateSearch: (search) => parseChatRouteSearch(search),
  search: {
    middlewares: [
      retainSearchParams<ChatRouteSearch>(['diff', 'panel', 'sidePanelExtensionId', 'sidePanelId']),
    ],
  },
  component: ChatSessionRouteView,
})
