import { SessionBranchId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionTree, SessionWorkspace } from '@shared/types/session'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { node, treeUiState } from '../../lib/__tests__/session-tree-test-fixtures'
import { useSessionTreePanelController } from '../useSessionTreePanelController'

const controllerMocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  updateSessionTreeUiState: vi.fn(),
  selectNode: vi.fn(),
}))

vi.mock('@/shell/ui-store', () => ({
  useUIStore: <T,>(selector: (state: { readonly showToast: (message: string) => void }) => T) =>
    selector({ showToast: controllerMocks.showToast }),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    updateSessionTreeUiState: controllerMocks.updateSessionTreeUiState,
  },
}))

vi.mock('../useSessionTreeFilterMode', () => ({
  useSessionTreeFilterMode: () => ({ filterMode: 'default', updateFilterMode: vi.fn() }),
}))

vi.mock('../useSessionTreeFocusSync', () => ({
  useSessionTreeFocusSync: vi.fn(),
}))

vi.mock('../useSessionTreeKeyboardControls', () => ({
  useSessionTreeKeyboardControls: vi.fn(),
}))

vi.mock('../useSessionTreeNodeSelection', () => ({
  useSessionTreeNodeSelection: () => ({ selectNode: controllerMocks.selectNode }),
}))

vi.mock('../useSessionTreeScrollControls', () => ({
  useSessionTreeScrollControls: () => ({
    scrollContainerRef: { current: null },
    showTreeScrollToBottom: false,
    syncTreeScrollButtonVisibility: vi.fn(),
    scrollToTreeBottom: vi.fn(),
  }),
}))

const SESSION_ID = SessionId('session-1')
const ROOT_NODE = node({ id: 'root', depth: 0, order: 1 })
const CHILD_NODE = node({ id: 'child', parentId: 'root', depth: 1, order: 2 })

function tree(): SessionTree {
  return {
    session: {
      id: SESSION_ID,
      title: 'Session tree',
      projectPath: '/repo',
      createdAt: 1,
      updatedAt: 2,
    },
    nodes: [ROOT_NODE, CHILD_NODE],
    branches: [
      {
        id: SessionBranchId('main'),
        sessionId: SESSION_ID,
        sourceNodeId: null,
        headNodeId: CHILD_NODE.id,
        name: 'main',
        isMain: true,
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    branchStates: [],
    uiState: treeUiState({ expandedNodeIds: ['root'], expandedNodeIdsTouched: true }),
  }
}

function workspace(): SessionWorkspace {
  return {
    tree: tree(),
    activeBranchId: SessionBranchId('main'),
    activeNodeId: CHILD_NODE.id,
    transcriptPath: [
      { node: ROOT_NODE, isActive: true },
      { node: CHILD_NODE, isActive: true },
    ],
  }
}

describe('useSessionTreePanelController', () => {
  beforeEach(() => {
    controllerMocks.updateSessionTreeUiState.mockReset()
    controllerMocks.selectNode.mockClear()
    controllerMocks.showToast.mockClear()
    controllerMocks.updateSessionTreeUiState.mockResolvedValue(undefined)
    useSessionStore.setState({ activeWorkspace: workspace(), draftBranch: null })
    usePreferencesStore.setState({
      settings: {
        selectedModel: SupportedModelId('openai/gpt-5.5'),
        favoriteModels: [],
        enabledModels: [],
        projectPath: '/repo',
        thinkingLevel: 'medium',
        recentProjects: [],
        skillTogglesByProject: {},
        projectDisplayNames: {},
      },
    })
  })

  it('derives panel content from active workspace and persists expansion changes', () => {
    const onClose = vi.fn()
    const { result } = renderHook(() => useSessionTreePanelController(onClose))

    expect(result.current.header.onClose).toBe(onClose)
    expect(result.current.content.tree?.session.id).toBe(SESSION_ID)
    expect(result.current.content.view?.visibleRows.map((row) => String(row.node.id))).toEqual([
      'root',
      'child',
    ])

    const rootRow = result.current.content.view?.visibleRows[0]
    if (!rootRow) throw new Error('Expected root row')
    act(() => result.current.content.rowActions.toggleNodeExpanded(rootRow))

    expect(controllerMocks.updateSessionTreeUiState).toHaveBeenCalledWith(SESSION_ID, {
      expandedNodeIds: [],
    })
  })

  it('routes row selection through the node selection hook', () => {
    const { result } = renderHook(() => useSessionTreePanelController(vi.fn()))

    act(() => result.current.content.rowActions.selectNode(CHILD_NODE))

    expect(controllerMocks.selectNode).toHaveBeenCalledWith(CHILD_NODE)
  })
})
