import { createFileRoute, retainSearchParams } from '@tanstack/react-router'
import { ChatSessionRouteView } from './-chat-route-views'
import {
  type ChatRouteSearch,
  NOTIFICATION_PROTOTYPE_ROUTES_ENABLED,
  parseChatRouteSearch,
} from './-route-search'

const RETAINED_CHAT_SEARCH_PARAMS = [
  'diff',
  'panel',
  'filePath',
  'fileLine',
  ...(NOTIFICATION_PROTOTYPE_ROUTES_ENABLED ? (['prototype', 'variant'] as const) : []),
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
