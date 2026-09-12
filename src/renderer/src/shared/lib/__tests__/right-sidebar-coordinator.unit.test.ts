import { beforeEach, describe, expect, it } from 'vitest'
import {
  DIFF_RIGHT_SIDEBAR_REQUEST,
  SESSION_TREE_RIGHT_SIDEBAR_REQUEST,
  useRightSidebarCoordinator,
} from '../right-sidebar-coordinator'

describe('right sidebar coordinator', () => {
  beforeEach(() => {
    useRightSidebarCoordinator.setState({ activeClaim: null })
  })

  it('gives the right side to the most recent explicit claim', () => {
    const coordinator = useRightSidebarCoordinator.getState()

    coordinator.claimRoute(DIFF_RIGHT_SIDEBAR_REQUEST)
    coordinator.claimWorkspace('session-1')
    expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
      kind: 'workspace',
      ownerKey: 'session-1',
    })

    coordinator.claimRoute(SESSION_TREE_RIGHT_SIDEBAR_REQUEST)
    expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
      kind: 'route',
      requestKey: SESSION_TREE_RIGHT_SIDEBAR_REQUEST,
    })
  })

  it('ignores cleanup from a route or Session that no longer owns the panel', () => {
    const coordinator = useRightSidebarCoordinator.getState()

    coordinator.claimRoute(DIFF_RIGHT_SIDEBAR_REQUEST)
    coordinator.claimWorkspace('session-1')
    coordinator.releaseRoute(DIFF_RIGHT_SIDEBAR_REQUEST)
    expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
      kind: 'workspace',
      ownerKey: 'session-1',
    })

    coordinator.claimRoute(SESSION_TREE_RIGHT_SIDEBAR_REQUEST)
    coordinator.releaseWorkspace('session-1')
    coordinator.releaseRoute(DIFF_RIGHT_SIDEBAR_REQUEST)
    expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
      kind: 'route',
      requestKey: SESSION_TREE_RIGHT_SIDEBAR_REQUEST,
    })
  })
})
