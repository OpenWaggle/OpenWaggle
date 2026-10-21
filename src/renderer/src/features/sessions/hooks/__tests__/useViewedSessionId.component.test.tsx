import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useViewedSessionId } from '../useViewedSessionId'

function ViewedSession() {
  return <output>{useViewedSessionId() ?? 'none'}</output>
}

/** The app's own shape: hash history, a Session route, and pages that are not Sessions. */
function renderAt(hash: string) {
  window.location.hash = hash
  const root = createRootRoute({
    component: () => (
      <>
        <ViewedSession />
        <Outlet />
      </>
    ),
  })
  const routes = [
    createRoute({ getParentRoute: () => root, path: '/' }),
    createRoute({ getParentRoute: () => root, path: '/sessions/$sessionId' }),
    createRoute({ getParentRoute: () => root, path: '/settings/$tab' }),
  ]
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createHashHistory(),
  })
  render(<RouterProvider router={router} />)
  return router
}

afterEach(() => {
  window.location.hash = ''
})

describe('useViewedSessionId', () => {
  it('names the Session the hash route shows, and none elsewhere', async () => {
    const router = renderAt('#/sessions/session-1')
    expect(await screen.findByText('session-1')).toBeInTheDocument()

    await act(() => router.navigate({ to: '/settings/$tab', params: { tab: 'general' } }))
    expect(await screen.findByText('none')).toBeInTheDocument()

    await act(() => router.navigate({ to: '/' }))
    expect(await screen.findByText('none')).toBeInTheDocument()
  })
})
