import {
  type AnyRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { type RenderResult, render } from '@testing-library/react'
import type { ReactNode } from 'react'

const ROUTED_MARKER = 'memory-router-ready'

/** An interface, so declarations name it instead of spelling out Testing Library's queries. */
export interface MemoryRouterRenderResult extends RenderResult {
  readonly router: AnyRouter
}

/**
 * Renders `ui` inside a real TanStack memory router, so router hooks (`useNavigate`,
 * `useRouterState`) run as in the app instead of being mocked. Resolves once the route rendered.
 */
export async function renderInMemoryRouter(ui: ReactNode, initialPath = '/') {
  const root = createRootRoute({
    component: () => (
      <>
        <span hidden data-testid={ROUTED_MARKER} />
        {ui}
      </>
    ),
  })
  const router = createRouter({
    // A catch-all child keeps the root, and so `ui`, mounted after a navigation to any path.
    routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path: '$' })]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    // jsdom has no window.scrollTo; a router that never restores scroll does not call it.
    scrollRestoration: () => false,
  })
  const view = render(<RouterProvider router={router} />)
  await view.findByTestId(ROUTED_MARKER)
  const result: MemoryRouterRenderResult = { ...view, router }
  return result
}
