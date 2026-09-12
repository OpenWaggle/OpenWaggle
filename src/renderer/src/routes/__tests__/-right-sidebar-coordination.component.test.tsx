import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DIFF_RIGHT_SIDEBAR_REQUEST,
  SESSION_TREE_RIGHT_SIDEBAR_REQUEST,
  useRightSidebarCoordinator,
} from '@/shared/lib/right-sidebar-coordinator'
import { coordinateSessionTreePanel, useRoutePanelClaim } from '../-right-sidebar-coordination'

interface RoutePanelClaimInput {
  readonly requestKey: string | null
  readonly scopeKey: string | null
}

function renderRoutePanelClaim(input: RoutePanelClaimInput) {
  return renderHook(
    ({ requestKey, scopeKey }: RoutePanelClaimInput) => useRoutePanelClaim(requestKey, scopeKey),
    { initialProps: input },
  )
}

describe('right sidebar route coordination', () => {
  beforeEach(() => {
    useRightSidebarCoordinator.setState({ activeClaim: null })
  })

  it('lets the latest explicit panel action win and releases its claim on unmount', () => {
    const view = renderRoutePanelClaim({
      requestKey: DIFF_RIGHT_SIDEBAR_REQUEST,
      scopeKey: 'session-1',
    })
    expect(view.result.current).toBe(true)

    act(() => useRightSidebarCoordinator.getState().claimWorkspace('session-1'))
    expect(view.result.current).toBe(false)

    act(() => coordinateSessionTreePanel(true))
    view.rerender({
      requestKey: SESSION_TREE_RIGHT_SIDEBAR_REQUEST,
      scopeKey: 'session-1',
    })
    expect(view.result.current).toBe(true)

    view.unmount()
    expect(useRightSidebarCoordinator.getState().activeClaim).toBeNull()
  })

  it('reclaims requested route state when the active Session changes', () => {
    const view = renderRoutePanelClaim({
      requestKey: DIFF_RIGHT_SIDEBAR_REQUEST,
      scopeKey: 'session-1',
    })
    act(() => useRightSidebarCoordinator.getState().claimWorkspace('session-1'))
    expect(view.result.current).toBe(false)

    view.rerender({
      requestKey: DIFF_RIGHT_SIDEBAR_REQUEST,
      scopeKey: 'session-2',
    })

    expect(view.result.current).toBe(true)
    expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
      kind: 'route',
      requestKey: DIFF_RIGHT_SIDEBAR_REQUEST,
    })
  })
})
