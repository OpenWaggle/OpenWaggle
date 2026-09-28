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

  it('restores the sidebar the action panel replaced when the panel closes', () => {
    const coordinator = useRightSidebarCoordinator.getState()

    coordinator.claimWorkspace('session-1')
    coordinator.claimActionPanel()
    coordinator.claimActionPanel()
    expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
      kind: 'action-panel',
      previous: { kind: 'workspace', ownerKey: 'session-1' },
    })
    coordinator.releaseActionPanel()
    expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
      kind: 'workspace',
      ownerKey: 'session-1',
    })
  })

  it('does not restore a sidebar that closed while the action panel covered it', () => {
    const coordinator = useRightSidebarCoordinator.getState()

    coordinator.claimRoute(DIFF_RIGHT_SIDEBAR_REQUEST, 'session-1')
    coordinator.claimActionPanel()
    coordinator.releaseRoute(SESSION_TREE_RIGHT_SIDEBAR_REQUEST)
    expect(useRightSidebarCoordinator.getState().activeClaim).toMatchObject({
      previous: { kind: 'route', requestKey: DIFF_RIGHT_SIDEBAR_REQUEST },
    })
    coordinator.releaseRoute(DIFF_RIGHT_SIDEBAR_REQUEST, 'session-1')
    coordinator.releaseActionPanel()
    expect(useRightSidebarCoordinator.getState().activeClaim).toBeNull()
  })

  it('lets another sidebar take the slot from the action panel without restoring anything', () => {
    const coordinator = useRightSidebarCoordinator.getState()

    coordinator.claimWorkspace('session-1')
    coordinator.claimActionPanel()
    coordinator.claimRoute(DIFF_RIGHT_SIDEBAR_REQUEST)
    coordinator.releaseActionPanel()
    expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
      kind: 'route',
      requestKey: DIFF_RIGHT_SIDEBAR_REQUEST,
    })
  })
})
