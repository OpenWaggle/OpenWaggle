import { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionSummary, SessionTree, SessionWorkspace } from '@shared/types/session'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '../session-store'

const mockApi = {
  listSessions: vi.fn(),
  getSessionTree: vi.fn(),
  getSessionWorkspace: vi.fn(),
}

vi.mock('@/lib/ipc', () => ({
  api: {
    listSessions: (...args: unknown[]) => mockApi.listSessions(...args),
    getSessionTree: (...args: unknown[]) => mockApi.getSessionTree(...args),
    getSessionWorkspace: (...args: unknown[]) => mockApi.getSessionWorkspace(...args),
  },
}))

function resetStore(): void {
  useSessionStore.setState({
    sessions: [],
    activeSessionTree: null,
    activeWorkspace: null,
    draftBranch: null,
    error: null,
  })
}

function makeSession(id: string, title = 'Session'): SessionSummary {
  return {
    id: SessionId(id),
    title,
    projectPath: null,
    createdAt: 1,
    updatedAt: 2,
    lastActiveNodeId: null,
    lastActiveBranchId: null,
  }
}

function makeTree(id: string): SessionTree {
  const session = makeSession(id)
  return {
    session,
    nodes: [],
    branches: [
      {
        id: SessionBranchId(`${id}:main`),
        sessionId: session.id,
        sourceNodeId: null,
        headNodeId: null,
        name: 'main',
        isMain: true,
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    branchStates: [
      {
        branchId: SessionBranchId(`${id}:main`),
        futureMode: 'standard',
        lastActiveAt: 2,
        uiStateJson: '{}',
      },
    ],
    uiState: null,
  }
}

function makeWorkspace(id: string): SessionWorkspace {
  const tree = makeTree(id)
  return {
    tree,
    activeBranchId: tree.branches[0]?.id ?? null,
    activeNodeId: null,
    activeBranchState: tree.branchStates[0],
    transcriptPath: [],
  }
}

describe('useSessionStore unit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  afterEach(() => {
    resetStore()
  })

  it('loads sessions from IPC', async () => {
    mockApi.listSessions.mockResolvedValue([makeSession('s1'), makeSession('s2')])

    await useSessionStore.getState().loadSessions()

    expect(useSessionStore.getState().sessions).toHaveLength(2)
  })

  it('refreshes the active tree for the selected session', async () => {
    const tree = makeTree('s1')
    mockApi.getSessionTree.mockResolvedValue(tree)

    await useSessionStore.getState().refreshSessionTree(SessionId('s1'))

    expect(useSessionStore.getState().activeSessionTree).toEqual(tree)
  })

  it('clears the active tree when sessionId is null', async () => {
    useSessionStore.setState({ activeSessionTree: makeTree('s1') })

    await useSessionStore.getState().refreshSessionTree(null)

    expect(useSessionStore.getState().activeSessionTree).toBeNull()
    expect(useSessionStore.getState().activeWorkspace).toBeNull()
    expect(mockApi.getSessionTree).not.toHaveBeenCalled()
  })

  it('tracks and clears draft branch state for a session', () => {
    const draftBranch = {
      sessionId: SessionId('s1'),
      sourceNodeId: SessionNodeId('node-1'),
    }

    useSessionStore.getState().setDraftBranch(draftBranch)
    expect(useSessionStore.getState().draftBranch).toEqual(draftBranch)

    useSessionStore.getState().clearDraftBranchForSession(SessionId('other-session'))
    expect(useSessionStore.getState().draftBranch).toEqual(draftBranch)

    useSessionStore.getState().clearDraftBranchForSession(SessionId('s1'))
    expect(useSessionStore.getState().draftBranch).toBeNull()
  })

  it('refreshes the active workspace for the selected session', async () => {
    const workspace = makeWorkspace('s1')
    const selection = { branchId: workspace.activeBranchId }
    mockApi.getSessionWorkspace.mockResolvedValue(workspace)

    await useSessionStore.getState().refreshSessionWorkspace(SessionId('s1'), selection)

    expect(mockApi.getSessionWorkspace).toHaveBeenCalledWith(SessionId('s1'), selection)
    expect(useSessionStore.getState().activeWorkspace).toEqual(workspace)
    expect(useSessionStore.getState().activeSessionTree).toEqual(workspace.tree)
  })
})
