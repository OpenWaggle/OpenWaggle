import { MessageId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionTranscriptEntry, SessionTree, SessionWorkspace } from '@shared/types/session'
import type { SessionWorkspaceRequest } from '@shared/types/session-transcript-window'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearTranscriptNodeCaches,
  TRANSCRIPT_WINDOW_PAGE_ENTRIES,
} from '../../lib/session-workspace-window'
import { useSessionStore } from '../session-store'

const mockApi = {
  getSessionTree: vi.fn(),
  getSessionWorkspace: vi.fn(),
}

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getSessionTree: (...args: unknown[]) => mockApi.getSessionTree(...args),
    getSessionWorkspace: (...args: unknown[]) => mockApi.getSessionWorkspace(...args),
  },
}))

function tree(sessionId: SessionId): SessionTree {
  return {
    session: { id: sessionId, title: 'S', projectPath: null, createdAt: 1, updatedAt: 2 },
    nodes: [],
    branches: [],
    branchStates: [],
    uiState: null,
  }
}

function entry(sessionId: SessionId, id: string, omitted = false): SessionTranscriptEntry {
  const node = {
    id: SessionNodeId(id),
    sessionId,
    parentId: null,
    piEntryType: 'message',
    kind: 'assistant_message' as const,
    timestampMs: 1,
    createdOrder: 1,
    pathDepth: 0,
    hasMessage: true,
  }
  return omitted
    ? { node, isActive: false, contentOmitted: true }
    : {
        node: {
          ...node,
          message: { id: MessageId(id), role: 'assistant', parts: [], createdAt: 1 },
        },
        isActive: false,
      }
}

function workspace(
  sessionId: SessionId,
  entries: readonly SessionTranscriptEntry[],
  window: { readonly startIndex: number; readonly pathLength: number },
  nodeMutationRevision = 5,
): SessionWorkspace {
  return {
    tree: tree(sessionId),
    activeBranchId: null,
    activeNodeId: entries.at(-1)?.node.id ?? null,
    transcriptPath: entries,
    transcriptWindow: window,
    nodeMutationRevision,
  }
}

function requestOf(call: number): SessionWorkspaceRequest | undefined {
  const request = mockApi.getSessionWorkspace.mock.calls[call]?.[2]
  return request
}

describe('session store transcript window (ADR 0036, B5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearTranscriptNodeCaches()
    useSessionStore.setState({ activeSessionTree: null, activeWorkspace: null, error: null })
  })

  it('refreshes the shown workspace instead of reading its tree separately', async () => {
    const sessionId = SessionId('tree-via-workspace')
    const selection = { branchId: null, nodeId: SessionNodeId('n1') }
    mockApi.getSessionWorkspace.mockResolvedValue(
      workspace(sessionId, [entry(sessionId, 'n1')], { startIndex: 0, pathLength: 1 }),
    )
    await useSessionStore.getState().refreshSessionWorkspace(sessionId, selection)

    await useSessionStore.getState().refreshSessionTree(sessionId)

    expect(mockApi.getSessionTree).not.toHaveBeenCalled()
    expect(mockApi.getSessionWorkspace).toHaveBeenCalledTimes(2)
    expect(mockApi.getSessionWorkspace.mock.calls[1]?.[1]).toEqual(selection)
  })

  it('shares identical reads made together and runs one trailing read for later ones', async () => {
    const sessionId = SessionId('coalesced')
    let release: () => void = () => undefined
    mockApi.getSessionWorkspace
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve(
                workspace(sessionId, [entry(sessionId, 'n1')], { startIndex: 0, pathLength: 1 }),
              )
          }),
      )
      .mockResolvedValue(
        workspace(sessionId, [entry(sessionId, 'n1'), entry(sessionId, 'n2')], {
          startIndex: 0,
          pathLength: 2,
        }),
      )
    const store = useSessionStore.getState()

    const first = store.refreshSessionWorkspace(sessionId)
    const joined = store.refreshSessionWorkspace(sessionId)
    await Promise.resolve()
    const laterA = store.refreshSessionWorkspace(sessionId)
    const laterB = store.refreshSessionWorkspace(sessionId)
    expect(mockApi.getSessionWorkspace).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([first, joined, laterA, laterB])

    // Calls after the first task share one trailing read, which sees the newer state.
    expect(mockApi.getSessionWorkspace).toHaveBeenCalledTimes(2)
    expect(useSessionStore.getState().activeWorkspace?.transcriptPath).toHaveLength(2)
  })

  it('names the nodes it holds and puts their content back, keeping their identity', async () => {
    const sessionId = SessionId('reuse')
    const firstEntries = [entry(sessionId, 'n1'), entry(sessionId, 'n2')]
    mockApi.getSessionWorkspace
      .mockResolvedValueOnce(workspace(sessionId, firstEntries, { startIndex: 0, pathLength: 2 }))
      .mockResolvedValueOnce(
        workspace(
          sessionId,
          [entry(sessionId, 'n1', true), entry(sessionId, 'n2', true), entry(sessionId, 'n3')],
          { startIndex: 0, pathLength: 3 },
        ),
      )
    await useSessionStore.getState().refreshSessionWorkspace(sessionId)
    await useSessionStore.getState().refreshSessionWorkspace(sessionId)

    expect(requestOf(1)).toEqual({
      window: { minEntries: TRANSCRIPT_WINDOW_PAGE_ENTRIES, includeNodeId: SessionNodeId('n1') },
      cached: { nodeMutationRevision: 5, nodeIds: [SessionNodeId('n1'), SessionNodeId('n2')] },
    })
    const path = useSessionStore.getState().activeWorkspace?.transcriptPath ?? []
    expect(path.map((item) => item.contentOmitted === true)).toEqual([false, false, false])
    expect(path[0]?.node).toBe(firstEntries[0]?.node)
  })

  it('reads again without naming held nodes when one of them is missing', async () => {
    const sessionId = SessionId('missing-held')
    mockApi.getSessionWorkspace
      .mockResolvedValueOnce(
        workspace(sessionId, [entry(sessionId, 'unknown', true)], { startIndex: 0, pathLength: 1 }),
      )
      .mockResolvedValueOnce(
        workspace(sessionId, [entry(sessionId, 'unknown')], { startIndex: 0, pathLength: 1 }),
      )

    await useSessionStore.getState().refreshSessionWorkspace(sessionId)

    expect(mockApi.getSessionWorkspace).toHaveBeenCalledTimes(2)
    expect(requestOf(1)?.cached).toBeUndefined()
    expect(
      useSessionStore.getState().activeWorkspace?.transcriptPath[0]?.node.message,
    ).toBeDefined()
  })

  it('reads the next older page when the reader reaches the top of the loaded window', async () => {
    const sessionId = SessionId('earlier')
    mockApi.getSessionWorkspace
      .mockResolvedValueOnce(
        workspace(sessionId, [entry(sessionId, 'n9')], { startIndex: 9, pathLength: 10 }),
      )
      .mockResolvedValueOnce(
        workspace(sessionId, [entry(sessionId, 'n8'), entry(sessionId, 'n9', true)], {
          startIndex: 8,
          pathLength: 10,
        }),
      )
    await useSessionStore.getState().refreshSessionWorkspace(sessionId)

    await useSessionStore.getState().loadEarlierTranscript(sessionId)

    expect(requestOf(1)?.window).toEqual({
      minEntries: 1 + TRANSCRIPT_WINDOW_PAGE_ENTRIES,
      includeNodeId: SessionNodeId('n9'),
    })
    const shown = useSessionStore.getState().activeWorkspace
    expect(shown?.transcriptPath.map((item) => String(item.node.id))).toEqual(['n8', 'n9'])
    expect(shown?.transcriptWindow?.startIndex).toBe(8)
  })

  it('reads back to a saved reading position deep in history', async () => {
    const sessionId = SessionId('anchor')
    mockApi.getSessionWorkspace.mockResolvedValue(
      workspace(sessionId, [entry(sessionId, 'n9')], { startIndex: 9, pathLength: 10 }),
    )
    await useSessionStore.getState().refreshSessionWorkspace(sessionId)

    await useSessionStore.getState().loadTranscriptThrough(sessionId, SessionNodeId('n2'))

    expect(requestOf(1)?.window?.includeNodeId).toBe(SessionNodeId('n2'))
  })

  it('does not read older history when the whole path is loaded', async () => {
    const sessionId = SessionId('complete')
    mockApi.getSessionWorkspace.mockResolvedValue(
      workspace(sessionId, [entry(sessionId, 'n1')], { startIndex: 0, pathLength: 1 }),
    )
    await useSessionStore.getState().refreshSessionWorkspace(sessionId)

    await useSessionStore.getState().loadEarlierTranscript(sessionId)

    expect(mockApi.getSessionWorkspace).toHaveBeenCalledTimes(1)
  })
})
