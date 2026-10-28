import { SessionBranchId, SessionId } from '@shared/types/brand'
import type { SessionTree, SessionWorkspace } from '@shared/types/session'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '../session-store'
import { SESSION_TREE_READ_GRACE_MS } from '../session-workspace-reads'

const mockApi = { getSessionTree: vi.fn(), getSessionWorkspace: vi.fn() }

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getSessionTree: (...args: unknown[]) => mockApi.getSessionTree(...args),
    getSessionWorkspace: (...args: unknown[]) => mockApi.getSessionWorkspace(...args),
  },
}))

function makeTree(id: string): SessionTree {
  const sessionId = SessionId(id)
  return {
    session: { id: sessionId, title: 'S', projectPath: null, createdAt: 1, updatedAt: 2 },
    nodes: [],
    branches: [
      {
        id: SessionBranchId(`${id}:main`),
        sessionId,
        sourceNodeId: null,
        headNodeId: null,
        name: 'main',
        isMain: true,
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    branchStates: [],
    uiState: null,
  }
}

function makeWorkspace(id: string): SessionWorkspace {
  const tree = makeTree(id)
  return { tree, activeBranchId: null, activeNodeId: null, transcriptPath: [] }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('A Session open reads its tree and workspace once (session open latency)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockApi.getSessionTree.mockReset()
    mockApi.getSessionWorkspace.mockReset()
    useSessionStore.setState({ activeSessionTree: null, activeWorkspace: null, error: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('serves the tree asked for as a Session becomes active from the workspace the route reads', async () => {
    const sessionId = SessionId('open-1')
    const workspace = deferred<SessionWorkspace>()
    mockApi.getSessionWorkspace.mockReturnValue(workspace.promise)
    const store = useSessionStore.getState()

    let treeDone = false
    const tree = store.refreshSessionTree(sessionId).then(() => {
      treeDone = true
    })
    await vi.advanceTimersByTimeAsync(SESSION_TREE_READ_GRACE_MS / 2)
    void store.showSessionWorkspace(sessionId, { branchId: null, nodeId: null })
    await vi.advanceTimersByTimeAsync(SESSION_TREE_READ_GRACE_MS)
    expect(treeDone).toBe(false)
    workspace.resolve(makeWorkspace('open-1'))
    await tree

    expect(mockApi.getSessionTree).not.toHaveBeenCalled()
    expect(mockApi.getSessionWorkspace).toHaveBeenCalledOnce()
    expect(useSessionStore.getState().activeSessionTree?.session.id).toBe(sessionId)
  })

  it('reads the tree on its own when no workspace read comes', async () => {
    const sessionId = SessionId('open-2')
    mockApi.getSessionTree.mockResolvedValue(makeTree('open-2'))

    const tree = useSessionStore.getState().refreshSessionTree(sessionId)
    await vi.advanceTimersByTimeAsync(SESSION_TREE_READ_GRACE_MS - 1)
    expect(mockApi.getSessionTree).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await tree

    expect(mockApi.getSessionTree).toHaveBeenCalledWith(sessionId)
    expect(useSessionStore.getState().activeSessionTree?.session.id).toBe(sessionId)
  })

  it('shows a workspace already shown or being read without reading it again', async () => {
    const sessionId = SessionId('open-3')
    const selection = { branchId: null, nodeId: null }
    const workspace = deferred<SessionWorkspace>()
    mockApi.getSessionWorkspace.mockReturnValue(workspace.promise)
    const store = useSessionStore.getState()

    const first = store.showSessionWorkspace(sessionId, selection)
    await Promise.resolve()
    const remounted = store.showSessionWorkspace(sessionId, selection)
    workspace.resolve(makeWorkspace('open-3'))
    await Promise.all([first, remounted])
    await store.showSessionWorkspace(sessionId, selection)

    expect(mockApi.getSessionWorkspace).toHaveBeenCalledOnce()
  })

  it('reads again for another selection, and a refresh always reads', async () => {
    const sessionId = SessionId('open-4')
    mockApi.getSessionWorkspace.mockResolvedValue(makeWorkspace('open-4'))
    const store = useSessionStore.getState()

    await store.showSessionWorkspace(sessionId, { branchId: null, nodeId: null })
    await store.showSessionWorkspace(sessionId, { branchId: SessionBranchId('open-4:b') })
    await store.refreshSessionWorkspace(sessionId, { branchId: SessionBranchId('open-4:b') })

    expect(mockApi.getSessionWorkspace).toHaveBeenCalledTimes(3)
  })
})
