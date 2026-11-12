import { SessionBranchId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail, SessionTree, SessionWorkspace } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, renderHook, waitFor } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useProviderStore } from '@/features/providers/state'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useUIStore } from '@/shell/ui-store'
import { node, treeUiState } from '../../lib/__tests__/session-tree-test-fixtures'

/*
 * Only the preload and the router are replaced: the session, chat, preference and UI stores and
 * every sub-hook of the controller are the real ones.
 */
const ipc = vi.hoisted(() => ({
  updateSessionTreeUiState: vi.fn(),
  getPiTreeFilterMode: vi.fn(),
  navigateSessionTree: vi.fn(),
  getSessionWorkspace: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi({
    updateSessionTreeUiState: ipc.updateSessionTreeUiState,
    getPiTreeFilterMode: ipc.getPiTreeFilterMode,
    navigateSessionTree: ipc.navigateSessionTree,
    getSessionWorkspace: ipc.getSessionWorkspace,
  }),
}))

// Branch selection navigates the app route tree, which these hook tests do not build.
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => ipc.navigate }))

import { useSessionTreePanelController } from '../useSessionTreePanelController'

const SESSION_ID = SessionId('session-1')
const PREFERRED_MODEL = SupportedModelId('openai/gpt-5.5')
const SESSION_MODEL = SupportedModelId('anthropic/claude-opus-4')
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

function rootRow(controller: ReturnType<typeof useSessionTreePanelController>) {
  const row = controller.content.view?.visibleRows[0]
  if (!row) throw new Error('Expected root row')
  return row
}

const initialChat = useChatStore.getInitialState()
const initialSessions = useSessionStore.getInitialState()
const initialPreferences = usePreferencesStore.getInitialState()
const initialProviders = useProviderStore.getInitialState()
const initialUI = useUIStore.getInitialState()

beforeEach(() => {
  vi.clearAllMocks()
  ipc.updateSessionTreeUiState.mockResolvedValue(undefined)
  ipc.getPiTreeFilterMode.mockResolvedValue('default')
  ipc.navigateSessionTree.mockResolvedValue({ cancelled: false })
  ipc.getSessionWorkspace.mockResolvedValue(workspace())
  useSessionStore.setState({ activeWorkspace: workspace(), draftBranch: null })
  usePreferencesStore.setState({
    settings: { ...DEFAULT_SETTINGS, selectedModel: PREFERRED_MODEL, projectPath: '/repo' },
  })
})

afterEach(() => {
  useChatStore.setState(initialChat, true)
  useSessionStore.setState(initialSessions, true)
  usePreferencesStore.setState(initialPreferences, true)
  useProviderStore.setState(initialProviders, true)
  useUIStore.setState(initialUI, true)
})

describe('useSessionTreePanelController', () => {
  it('derives panel content from the active workspace and persists expansion changes', async () => {
    const onClose = vi.fn()
    const { result } = renderHook(() => useSessionTreePanelController(onClose))

    expect(result.current.header.onClose).toBe(onClose)
    expect(result.current.content.tree?.session.id).toBe(SESSION_ID)
    expect(result.current.content.view?.visibleRows.map((row) => String(row.node.id))).toEqual([
      'root',
      'child',
    ])
    // The filter mode is read for the tree's project.
    await waitFor(() => expect(ipc.getPiTreeFilterMode).toHaveBeenCalledWith('/repo'))

    act(() => result.current.content.rowActions.toggleNodeExpanded(rootRow(result.current)))

    // Collapsed at once, before the Host write settles.
    expect(result.current.content.view?.visibleRows.map((row) => String(row.node.id))).toEqual([
      'root',
    ])
    expect(ipc.updateSessionTreeUiState).toHaveBeenCalledWith(SESSION_ID, { expandedNodeIds: [] })
  })

  it('names a failed expansion write in a toast', async () => {
    ipc.updateSessionTreeUiState.mockRejectedValue(new Error('disk full'))
    const { result } = renderHook(() => useSessionTreePanelController(vi.fn()))

    act(() => result.current.content.rowActions.toggleNodeExpanded(rootRow(result.current)))

    await waitFor(() =>
      expect(useUIStore.getState().toastMessage).toBe(
        'Failed to save Session Tree state: disk full',
      ),
    )
  })

  it.each([
    {
      name: "the open Session's model",
      activeSession: { id: SESSION_ID, executionModel: SESSION_MODEL },
      model: SESSION_MODEL,
    },
    {
      name: 'the preferred model when the open Session has none',
      activeSession: { id: SESSION_ID },
      model: PREFERRED_MODEL,
    },
  ])('switches to a selected branch head on $name', async ({ activeSession, model }) => {
    useChatStore.setState({ activeSession: fromPartial<SessionDetail>(activeSession) })
    const { result } = renderHook(() => useSessionTreePanelController(vi.fn()))

    act(() => result.current.content.rowActions.selectNode(CHILD_NODE))

    await waitFor(() =>
      expect(ipc.navigateSessionTree).toHaveBeenCalledWith(SESSION_ID, model, CHILD_NODE.id, {
        summarize: false,
      }),
    )
  })

  it('refuses a branch switch while another Session is open, so no model is known', () => {
    useChatStore.setState({
      activeSession: fromPartial<SessionDetail>({
        id: SessionId('other-session'),
        executionModel: SESSION_MODEL,
      }),
    })
    const { result } = renderHook(() => useSessionTreePanelController(vi.fn()))

    act(() => result.current.content.rowActions.selectNode(CHILD_NODE))

    expect(useUIStore.getState().toastMessage).toBe('Select a model before switching branches.')
    expect(ipc.navigateSessionTree).not.toHaveBeenCalled()
  })
})
