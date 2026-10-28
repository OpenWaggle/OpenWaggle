import { createBrowserHistory, createHashHistory, createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { useSyncExternalStore } from 'react'
import { env } from '@/env'
import { rendererQueryClient } from '@/queries/query-client'
import { createRendererLogger } from '@/shared/lib/logger'
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

const logger = createRendererLogger('router')
let initialRouteLoad: Promise<void> | null = null
let initialRouteLoadSettled = false
const initialRouteLoadListeners = new Set<() => void>()

/**
 * Matches the launch location and loads its lazy route chunks before `RouterProvider` mounts.
 *
 * Called from the renderer entry, so the route chunk download overlaps entry evaluation and the
 * settings read instead of starting after it. When the load has settled by the time
 * `RouterProvider` mounts, the first route render does not suspend: React commits no route
 * fallback and so never holds the chat behind its 300 ms Suspense fallback throttle
 * (renderer-load B1). The returned promise settles once; repeated calls share it.
 */
export function startInitialRouteLoad(): Promise<void> {
  initialRouteLoad ??= router
    .load()
    .catch((error: unknown) => {
      // RouterProvider loads the location again on mount and renders its error state.
      logger.warn('Initial route preload failed', { error })
    })
    .finally(() => {
      initialRouteLoadSettled = true
      for (const listener of initialRouteLoadListeners) listener()
    })
  return initialRouteLoad
}

function subscribeToInitialRouteLoad(listener: () => void) {
  void startInitialRouteLoad()
  initialRouteLoadListeners.add(listener)
  return () => {
    initialRouteLoadListeners.delete(listener)
  }
}

function readInitialRouteLoadSettled() {
  return initialRouteLoadSettled
}

/**
 * Whether the launch route load has settled, so the boot gate can mount `RouterProvider` without
 * a suspended first route render. Starts the load if the entry has not.
 */
export function useInitialRouteLoadSettled(): boolean {
  return useSyncExternalStore(subscribeToInitialRouteLoad, readInitialRouteLoadSettled)
}

setupRouterSsrQueryIntegration({
  router,
  queryClient: rendererQueryClient,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
