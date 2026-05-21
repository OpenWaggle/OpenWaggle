import { SessionBranchId, SessionNodeId } from '@shared/types/brand'
import type { SessionBranch, SessionTree } from '@shared/types/session'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  node,
  SESSION_ID,
  treeUiState,
  visibleRows,
} from '../../lib/__tests__/session-tree-test-fixtures'
import type { SessionTreePanelContent as SessionTreePanelContentModel } from '../../model'
import { SessionTreePanelContent } from '../SessionTreePanelContent'
import { SessionTreePanelFilters } from '../SessionTreePanelFilters'
import { SessionTreePanelHeader } from '../SessionTreePanelHeader'
import { SessionTreeRows } from '../SessionTreeRows'

const BRANCH_ID = SessionBranchId('main-branch')

function branch(headNodeId: string) {
  return {
    id: BRANCH_ID,
    sessionId: SESSION_ID,
    sourceNodeId: null,
    headNodeId: SessionNodeId(headNodeId),
    name: 'main',
    isMain: true,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
  } satisfies SessionBranch
}

function makeTree() {
  const nodes = [
    node({ id: 'root', depth: 0, order: 1 }),
    node({ id: 'child', parentId: 'root', depth: 1, order: 2 }),
  ]

  return {
    session: {
      id: SESSION_ID,
      title: 'Session',
      projectPath: '/repo',
      lastActiveNodeId: SessionNodeId('child'),
      lastActiveBranchId: BRANCH_ID,
      createdAt: 1,
      updatedAt: 1,
    },
    nodes,
    branches: [branch('child')],
    branchStates: [],
    uiState: treeUiState({ expandedNodeIds: ['root'], expandedNodeIdsTouched: true }),
  } satisfies SessionTree
}

function makeContent(overrides: Partial<SessionTreePanelContentModel>) {
  const base = {
    rowActions: {
      focusIndex: vi.fn(),
      selectNode: vi.fn(),
      toggleNodeExpanded: vi.fn(),
    },
    rowRefs: { current: new Map<string, HTMLButtonElement>() },
    scrollContainerRef: { current: null },
    searchActive: false,
    showTreeScrollToBottom: false,
    tree: null,
    treeRowsRef: { current: null },
    view: null,
    onScrollToTreeBottom: vi.fn(),
    onTreeScroll: vi.fn(),
  } satisfies SessionTreePanelContentModel

  return { ...base, ...overrides }
}

describe('Session Tree panel components', () => {
  it('renders header controls and delegates close', () => {
    const onClose = vi.fn()

    render(<SessionTreePanelHeader onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close Session Tree' }))

    expect(screen.getByText('Session Tree')).toBeInTheDocument()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders filter controls and delegates search/filter changes', () => {
    const onFilterModeChange = vi.fn()
    const onSearchQueryChange = vi.fn()

    render(
      <SessionTreePanelFilters
        filters={{
          filterMode: 'default',
          searchQuery: '',
          onFilterModeChange,
          onSearchQueryChange,
        }}
      />,
    )

    fireEvent.change(screen.getByLabelText('Filter'), { target: { value: 'user-only' } })
    fireEvent.change(screen.getByLabelText('Search Session Tree nodes'), {
      target: { value: 'summary' },
    })

    expect(onFilterModeChange).toHaveBeenCalledWith('user-only')
    expect(onSearchQueryChange).toHaveBeenCalledWith('summary')
  })

  it('renders empty tree states without row actions', () => {
    const { rerender } = render(<SessionTreePanelContent content={makeContent({})} />)

    expect(screen.getByText('No session tree yet.')).toBeInTheDocument()

    rerender(
      <SessionTreePanelContent
        content={makeContent({
          tree: makeTree(),
          searchActive: true,
          view: { ...makeRowsView(), visibleRows: [] },
        })}
      />,
    )

    expect(screen.getByText('No nodes match this search.')).toBeInTheDocument()
  })

  it('renders visible rows, records row refs, and delegates row actions', () => {
    const tree = makeTree()
    const rows = visibleRows({ nodes: tree.nodes, expandedNodeIds: ['root'] })
    const focusIndex = vi.fn()
    const selectNode = vi.fn()
    const toggleNodeExpanded = vi.fn()
    const rowRefs = { current: new Map<string, HTMLButtonElement>() }

    render(
      <SessionTreeRows
        actions={{ focusIndex, selectNode, toggleNodeExpanded }}
        refs={{ rowRefs }}
        view={{
          activeBranchId: BRANCH_ID,
          activePathIds: new Set(['root', 'child']),
          clampedFocusIndex: 0,
          draftBranch: { sessionId: SESSION_ID, sourceNodeId: SessionNodeId('child') },
          rowExpandedNodeIds: [SessionNodeId('root')],
          tree,
          visibleRows: rows,
        }}
      />,
    )

    fireEvent.click(screen.getAllByText('assistant message')[0])
    fireEvent.click(screen.getAllByRole('button')[0])

    expect(screen.getAllByText('Assistant')).toHaveLength(2)
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(rowRefs.current.has('root')).toBe(true)
    expect(selectNode).toHaveBeenCalledWith(tree.nodes[0])
    expect(toggleNodeExpanded).toHaveBeenCalledWith(rows[0])
  })
})

function makeRowsView() {
  const tree = makeTree()
  return {
    activeBranchId: BRANCH_ID,
    activePathIds: new Set<string>(),
    clampedFocusIndex: 0,
    draftBranch: null,
    rowExpandedNodeIds: [],
    tree,
    visibleRows: visibleRows({ nodes: tree.nodes }),
  }
}
