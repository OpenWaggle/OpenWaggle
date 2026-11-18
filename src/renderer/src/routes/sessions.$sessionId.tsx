import { createFileRoute, retainSearchParams } from '@tanstack/react-router'
import { ChatSessionRouteView } from './-chat-route-views'
import { type ChatRouteSearch, parseChatRouteSearch } from './-route-search'

const RETAINED_CHAT_SEARCH_PARAMS = [
  'diff',
  'panel',
  'filePath',
  'fileLine',
  'sidePanelExtensionId',
  'sidePanelId',
  'sidePanelPackagePath',
  'sidePanelContentHash',
] satisfies readonly (keyof ChatRouteSearch)[]

export const Route = createFileRoute('/sessions/$sessionId')({
  validateSearch: (search) => parseChatRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<ChatRouteSearch>(RETAINED_CHAT_SEARCH_PARAMS)],
  },
  component: ChatSessionRouteView,
})
