import { createFileRoute, retainSearchParams } from '@tanstack/react-router';
import { ChatSessionRouteView } from './-chat-route-views';
import { parseChatRouteSearch } from './-route-search';
export const Route = createFileRoute('/sessions/$sessionId')({
    validateSearch: (search) => parseChatRouteSearch(search),
    search: {
        middlewares: [
            retainSearchParams([
                'diff',
                'panel',
                'sidePanelExtensionId',
                'sidePanelId',
                'sidePanelPackagePath',
                'sidePanelContentHash',
            ]),
        ],
    },
    component: ChatSessionRouteView,
});
