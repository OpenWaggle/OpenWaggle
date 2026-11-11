import { QueryClientProvider } from '@tanstack/react-query'
import { act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createRendererQueryClient } from '@/queries/query-client'
import { renderInMemoryRouter } from '@/test-utils/memory-router'
import { WorkspaceShell } from '../WorkspaceShell'

interface RoutedView {
  readonly unmount: () => void
  /** Moves the memory router to `to`, as a link or the address bar would. */
  readonly navigate: (to: string) => Promise<void>
}

/**
 * Renders `element` at `pathname` under a real memory router and a fresh query client, so it
 * reads the route and the test preload the way the app does.
 */
export async function renderAtRoute(element: ReactNode, pathname = '/'): Promise<RoutedView> {
  const client = createRendererQueryClient()
  const { router, unmount } = await renderInMemoryRouter(
    <QueryClientProvider client={client}>{element}</QueryClientProvider>,
    pathname,
  )
  return {
    unmount,
    navigate: (to) =>
      act(async () => {
        await router.navigate({ to })
      }),
  }
}

/** The workspace shell around `<main>Route content</main>`, at `pathname`; see renderAtRoute. */
export function renderWorkspaceShell(pathname = '/'): Promise<RoutedView> {
  return renderAtRoute(
    <WorkspaceShell>
      <main>Route content</main>
    </WorkspaceShell>,
    pathname,
  )
}
