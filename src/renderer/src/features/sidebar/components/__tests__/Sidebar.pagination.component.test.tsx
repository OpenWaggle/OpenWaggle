import { fireEvent, render, screen } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { useSidebarController } from '../../hooks/useSidebarController'
import { Sidebar } from '../Sidebar'

interface TestState {
  controller: ReturnType<typeof useSidebarController> | undefined
  loadMore: ReturnType<typeof vi.fn>
}

const testState: TestState = vi.hoisted(() => ({
  controller: undefined,
  loadMore: vi.fn(),
}))

vi.mock('../../hooks/useSidebarController', () => ({
  useSidebarController: () => {
    if (!testState.controller) throw new Error('Sidebar controller test state was not initialized')
    return testState.controller
  },
}))
vi.mock('../../hooks/useSessionGitIndicators', () => ({
  useSessionGitIndicators: vi.fn(),
}))
vi.mock('../SidebarNavigation', () => ({
  SidebarBrandArea: () => null,
  SidebarPrimaryActions: () => null,
  SidebarProjectsHeader: () => <div>Projects</div>,
  SidebarSettingsButton: () => null,
}))
vi.mock('../SidebarPinnedSection', () => ({ SidebarPinnedSection: () => null }))
vi.mock('../SidebarProjectList', () => ({ SidebarProjectList: () => null }))
vi.mock('../SidebarSearchBox', () => ({ SidebarSearchBox: () => null }))
vi.mock('../SidebarStatusIndicators', () => ({ SidebarStatusChips: () => null }))

describe('Sidebar catalog pagination', () => {
  beforeEach(() => {
    testState.loadMore.mockClear()
    testState.controller = fromPartial<ReturnType<typeof useSidebarController>>({
      activeSessionId: null,
      activeView: 'chat',
      chipCounts: [],
      filterState: null,
      hasMoreVisibleSessions: true,
      isFullscreen: false,
      loadMoreVisibleSessions: testState.loadMore,
      pinnedRows: [],
      projectExpandedByPath: {},
      searchQuery: '',
      sessionGroups: { projects: [] },
      sidebarOpen: true,
      sortMode: 'recent',
    })
  })

  it('keeps the next page reachable when the rendered catalog cannot scroll', () => {
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'Load more sessions' }))

    expect(testState.loadMore).toHaveBeenCalledOnce()
  })
})
