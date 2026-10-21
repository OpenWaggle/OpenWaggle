import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const route = vi.hoisted(() => ({ pathname: '/' }))

vi.mock('@tanstack/react-router', () => ({
  useRouterState: <T,>(options: {
    readonly select: (state: { readonly location: { readonly pathname: string } }) => T
  }) => options.select({ location: { pathname: route.pathname } }),
}))

const { useViewedSessionId } = await import('../useViewedSessionId')

function viewedAt(pathname: string) {
  route.pathname = pathname
  return renderHook(() => useViewedSessionId()).result.current
}

describe('useViewedSessionId', () => {
  it('names the Session the route shows', () => {
    expect(viewedAt('/sessions/session-1')).toBe('session-1')
  })

  it('names none on a draft, Settings, or another page, even with an active Session', () => {
    expect(viewedAt('/')).toBeNull()
    expect(viewedAt('/settings/general')).toBeNull()
    expect(viewedAt('/skills')).toBeNull()
    expect(viewedAt('/sessions')).toBeNull()
  })
})
