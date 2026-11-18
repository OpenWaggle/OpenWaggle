import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { trackRoutedNode } from '../follow-branch-head'

const SESSION_ID = SessionId('session-1')

function fakeRouter(pathname: string, search: { readonly node?: string }) {
  const location = { pathname, search }
  const navigate = vi.fn(async () => undefined)
  return {
    navigate,
    moveTo(nextPathname: string, nextSearch: { readonly node?: string }) {
      location.pathname = nextPathname
      location.search = nextSearch
    },
    router: fromPartial<Parameters<typeof trackRoutedNode>[0]>({ state: { location }, navigate }),
  }
}

describe('trackRoutedNode', () => {
  it('drops the node routed at send time so the view follows the branch head', () => {
    const { navigate, router } = fakeRouter('/sessions/session-1', { node: 'retry-source' })

    trackRoutedNode(router, SESSION_ID)()

    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: { sessionId: 'session-1' }, replace: true }),
    )
  })

  it('leaves the route alone once the user moved elsewhere during the send', () => {
    const tracked = fakeRouter('/sessions/session-1', { node: 'retry-source' })
    const followBranchHead = trackRoutedNode(tracked.router, SESSION_ID)

    tracked.moveTo('/settings', {})
    followBranchHead()
    tracked.moveTo('/sessions/session-1', { node: 'other-node' })
    followBranchHead()

    expect(tracked.navigate).not.toHaveBeenCalled()
  })

  it('does nothing for a send without a routed node', () => {
    const { navigate, router } = fakeRouter('/sessions/session-1', {})

    trackRoutedNode(router, SESSION_ID)()

    expect(navigate).not.toHaveBeenCalled()
  })
})
