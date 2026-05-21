import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionTreePanel } from '../SessionTreePanel'

const panelControllerMock = vi.hoisted(() => ({
  onClose: vi.fn(),
}))

vi.mock('../../hooks/useSessionTreePanelController', () => ({
  useSessionTreePanelController: (onClose: () => void) => ({
    header: { onClose },
    filters: {
      filterMode: 'default',
      searchQuery: '',
      onFilterModeChange: vi.fn(),
      onSearchQueryChange: vi.fn(),
    },
    content: {
      rowActions: {
        focusIndex: vi.fn(),
        selectNode: vi.fn(),
        toggleNodeExpanded: vi.fn(),
      },
      rowRefs: { current: new Map() },
      scrollContainerRef: { current: null },
      searchActive: false,
      showTreeScrollToBottom: false,
      tree: null,
      treeRowsRef: { current: null },
      view: null,
      onScrollToTreeBottom: vi.fn(),
      onTreeScroll: vi.fn(),
    },
  }),
}))

describe('SessionTreePanel', () => {
  it('composes the header, filters, and empty content under a labelled panel', () => {
    render(<SessionTreePanel onClose={panelControllerMock.onClose} />)

    expect(screen.getByRole('region', { name: 'Session Tree' })).toBeInTheDocument()
    expect(screen.getByText('Session Tree')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search nodes')).toBeInTheDocument()
    expect(screen.getByText('No session tree yet.')).toBeInTheDocument()
  })
})
