import { createBrowserHistory, createHashHistory, createRouter } from '@tanstack/react-router'
import { env } from '@/env'
import { routeTree } from './routeTree.gen'

const history = env.isElectron ? createHashHistory() : createBrowserHistory()

export const router = createRouter({
  routeTree,
  history,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
