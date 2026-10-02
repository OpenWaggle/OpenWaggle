import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRightPanelMaximizeStore } from '@/shared/lib/right-panel-maximize'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'

const mocks = vi.hoisted(() => ({ narrow: false }))

vi.mock('@/features/chat/hooks', () => ({ useChat: () => ({ activeSession: null }) }))
vi.mock('@/features/sessions/hooks', () => ({ useProject: () => ({ projectPath: '/repo' }) }))
vi.mock('@/shared/hooks/useMediaQuery', () => ({ useMediaQuery: () => mocks.narrow }))

import { useWorkspacePanelStore } from '../../workspace-panel-store'
import { RightPanelMaximizePublisher } from '../RightPanelMaximizePublisher'

const OWNER = 'draft:/repo'

function target() {
  return useRightPanelMaximizeStore.getState().target
}

describe('RightPanelMaximizePublisher', () => {
  beforeEach(() => {
    mocks.narrow = false
    useWorkspacePanelStore.setState({ groups: {} })
    useRightSidebarCoordinator.setState({ activeClaim: null })
  })
  afterEach(() => useRightPanelMaximizeStore.setState({ target: null }))

  it('publishes the Session maximize state on any page and withdraws it on unmount', () => {
    useRightSidebarCoordinator.getState().claimRoute('diff')
    const { unmount } = render(<RightPanelMaximizePublisher />)
    expect(target()).toMatchObject({ maximized: false, canMaximize: true })

    act(() => target()?.toggle())
    expect(useWorkspacePanelStore.getState().groups[OWNER]?.maximized).toBe(true)
    expect(target()?.maximized).toBe(true)

    unmount()
    expect(target()).toBeNull()
  })

  it('offers no maximize control in a narrow-window sheet or under the guided action panel', () => {
    mocks.narrow = true
    const { rerender } = render(<RightPanelMaximizePublisher />)
    expect(target()?.canMaximize).toBe(false)

    mocks.narrow = false
    act(() => useRightSidebarCoordinator.getState().claimActionPanel())
    rerender(<RightPanelMaximizePublisher />)
    expect(target()?.canMaximize).toBe(false)
  })
})
