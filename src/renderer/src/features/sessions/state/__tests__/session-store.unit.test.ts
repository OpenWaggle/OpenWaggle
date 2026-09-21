import { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionSummary, SessionTree, SessionWorkspace } from '@shared/types/session'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '../session-store'

const mockApi = {
  listSessionCatalogPage: vi.fn(),
  listHiveSessionCatalogPage: vi.fn(),
  listPinnedSessions: vi.fn(),
  listSessionsByIds: vi.fn(),
  getSessionTree: vi.fn(),
  getSessionWorkspace: vi.fn(),
}

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionCatalogPage: (...args: unknown[]) => mockApi.listSessionCatalogPage(...args),
    listHiveSessionCatalogPage: (...args: unknown[]) => mockApi.listHiveSessionCatalogPage(...args),
    listPinnedSessions: (...args: unknown[]) => mockApi.listPinnedSessions(...args),
    listSessionsByIds: (...args: unknown[]) => mockApi.listSessionsByIds(...args),
    getSessionTree: (...args: unknown[]) => mockApi.getSessionTree(...args),
    getSessionWorkspace: (...args: unknown[]) => mockApi.getSessionWorkspace(...args),
  },
}))

function resetStore() {
  useSessionStore.setState({
    sessions: [],
    archivedSessions: [],
    hiveSessions: [],
    hiveContextSessionId: null,
    sessionsNextCursor: null,
    archivedSessionsNextCursor: null,
    hiveWorkersNextCursor: null,
    sessionsLoadingMore: false,
    archivedSessionsLoadingMore: false,
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
  const activeBranchState = tree.branchStates[0]
  if (!activeBranchState) {
    throw new Error('Expected test tree to include an active branch state')
  }

  return {
    tree,
    activeBranchId: tree.branches[0]?.id ?? null,
    activeNodeId: null,
    activeBranchState,
    transcriptPath: [],
  }
}

describe('useSessionStore unit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.listSessionCatalogPage.mockResolvedValue({ sessions: [] })
    mockApi.listHiveSessionCatalogPage.mockResolvedValue({ context: [], workers: [] })
    mockApi.listPinnedSessions.mockResolvedValue([])
    mockApi.listSessionsByIds.mockResolvedValue([])
    resetStore()
  })

  afterEach(() => {
    resetStore()
  })

  it('loads sessions from IPC', async () => {
    mockApi.listSessionCatalogPage.mockImplementation(async (archived: boolean) => ({
      sessions: archived
        ? [{ ...makeSession('s3'), archived: true }]
        : [makeSession('s1'), makeSession('s2')],
    }))

    await useSessionStore.getState().loadSessions()

    expect(useSessionStore.getState().sessions).toHaveLength(2)
    expect(useSessionStore.getState().archivedSessions).toHaveLength(1)
  })

  it('does not let an older catalog request overwrite a newer refresh', async () => {
    let resolveOlder: (sessions: readonly SessionSummary[]) => void = () => undefined
    const olderRequest = new Promise<readonly SessionSummary[]>((resolve) => {
      resolveOlder = resolve
    })
    mockApi.listSessionCatalogPage
      .mockImplementationOnce((archived: boolean) =>
        archived
          ? Promise.resolve({ sessions: [] })
          : olderRequest.then((sessions) => ({ sessions })),
      )
      .mockResolvedValueOnce({ sessions: [] })
      .mockResolvedValueOnce({ sessions: [makeSession('newer')] })
      .mockResolvedValueOnce({ sessions: [] })

    const first = useSessionStore.getState().loadSessions()
    const second = useSessionStore.getState().loadSessions()
    await second
    resolveOlder([makeSession('older')])
    await first

    expect(useSessionStore.getState().sessions.map((session) => session.id)).toEqual(['newer'])
  })

  it('appends keyset pages without duplicating Sessions', async () => {
    mockApi.listSessionCatalogPage.mockImplementation(
      async (archived: boolean, _limit: number, cursor?: string) => {
        if (archived) return { sessions: [] }
        if (cursor) return { sessions: [makeSession('s2'), makeSession('s3')] }
        return { sessions: [makeSession('s1'), makeSession('s2')], nextCursor: 'next' }
      },
    )

    await useSessionStore.getState().loadSessions()
    await useSessionStore.getState().loadMoreSessions()

    expect(useSessionStore.getState().sessions.map((session) => session.id)).toEqual([
      's1',
      's2',
      's3',
    ])
  })

  it('appends archived keyset pages without duplicating Sessions', async () => {
    mockApi.listSessionCatalogPage.mockImplementation(
      async (archived: boolean, _limit: number, cursor?: string) => {
        if (!archived) return { sessions: [] }
        if (cursor) {
          return {
            sessions: [
              { ...makeSession('archived-2'), archived: true },
              { ...makeSession('archived-3'), archived: true },
            ],
          }
        }
        return {
          sessions: [
            { ...makeSession('archived-1'), archived: true },
            { ...makeSession('archived-2'), archived: true },
          ],
          nextCursor: 'next-archived',
        }
      },
    )

    await useSessionStore.getState().loadSessions()
    await useSessionStore.getState().loadMoreArchivedSessions()

    expect(useSessionStore.getState().archivedSessions.map((session) => session.id)).toEqual([
      'archived-1',
      'archived-2',
      'archived-3',
    ])
    expect(useSessionStore.getState().archivedSessionsNextCursor).toBeNull()
  })

  it('loads focused Hive context independently from the global page', async () => {
    mockApi.listHiveSessionCatalogPage.mockResolvedValue({
      context: [makeSession('queen')],
      workers: [makeSession('worker')],
      nextCursor: 'more-workers',
    })

    await useSessionStore.getState().loadHiveSessions(SessionId('queen'))

    expect(useSessionStore.getState().hiveSessions.map((session) => session.id)).toEqual([
      'queen',
      'worker',
    ])
    expect(useSessionStore.getState().hiveWorkersNextCursor).toBe('more-workers')
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
