import { createBrowserHistory, createHashHistory, createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { env } from '@/env'
import { rendererQueryClient } from '@/queries/query-client'
import { routeTree } from './routeTree.gen'

const DISABLE_ROUTER_PRELOAD_CACHE_MS = 0
const history = env.isElectron ? createHashHistory() : createBrowserHistory()

export const router = createRouter({
  routeTree,
  history,
  context: {
    queryClient: rendererQueryClient,
  },
  defaultPreloadStaleTime: DISABLE_ROUTER_PRELOAD_CACHE_MS,
})

setupRouterSsrQueryIntegration({
  router,
  queryClient: rendererQueryClient,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
