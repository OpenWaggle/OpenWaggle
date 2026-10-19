import { SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import type { SessionDetail, SessionWorkspace } from '@shared/types/session'
import { act, renderHook } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useComposerStore } from '@/features/composer/state'
import { useProviderStore } from '@/features/providers/state'
import { useSessionCopyWorkflow } from '../useSessionCopyWorkflow'
import { assistantNode } from './session-copy-workflow-fixtures'

const apiMock = vi.hoisted(() => ({
  cloneSessionToNew: vi.fn(),
  forkSessionToNew: vi.fn(),
  getSessionWorkspace: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

it('clones a Session whose model cannot run now, since a copy runs no model', async () => {
  const sessionId = SessionId('session-signed-out')
  const signedOut = SupportedModelId('amazon-bedrock/eu.anthropic.claude-fable-5')
  useProviderStore.setState({
    providerModels: [
      fromPartial<ProviderInfo>({
        provider: 'amazon-bedrock',
        models: [fromPartial({ id: signedOut, name: 'Fable', available: false })],
      }),
    ],
    catalogHydrated: true,
  })
  useChatStore.setState({ activeSessionId: sessionId, sessionById: new Map() })
  apiMock.cloneSessionToNew.mockReset().mockResolvedValue({ cancelled: true })
  const showToast = vi.fn()
  const { result } = renderHook(() =>
    useSessionCopyWorkflow({
      activeSessionId: sessionId,
      activeWorkspace: null,
      messages: [],
      draftBranchSourceNodeId: SessionNodeId('head'),
      model: signedOut,
      navigate: vi.fn(),
      setActiveSession: vi.fn(),
      loadSessions: vi.fn().mockResolvedValue(undefined),
      refreshSession: vi.fn().mockResolvedValue(undefined),
      refreshSessionWorkspace: vi.fn().mockResolvedValue(undefined),
      showToast,
    }),
  )

  await act(() => result.current.cloneCurrentSessionToNewSession())

  expect(showToast).not.toHaveBeenCalledWith('Select a model before cloning.')
  expect(apiMock.cloneSessionToNew).toHaveBeenCalledWith(
    sessionId,
    signedOut,
    SessionNodeId('head'),
  )
})

it("forks after a turn's reply: a copy through the reply's persisted node, with an empty draft", async () => {
  const sessionId = SessionId('session-reply')
  const forkedSessionId = SessionId('session-reply-fork')
  const reply = assistantNode('reply-node', sessionId)
  useChatStore.setState({ activeSessionId: sessionId, sessionById: new Map() })
  // A draft left in the composer must not follow the user into the copy.
  useComposerStore.setState({ input: 'stale draft' })
  apiMock.getSessionWorkspace.mockReset().mockResolvedValue(null)
  apiMock.cloneSessionToNew.mockReset().mockResolvedValue({
    cancelled: false,
    session: fromPartial<SessionDetail>({ id: forkedSessionId, messages: [] }),
  })
  const workspace: SessionWorkspace = fromPartial({
    tree: { session: { id: sessionId }, nodes: [reply], branches: [] },
    activeBranchId: null,
    activeNodeId: reply.id,
    transcriptPath: [{ node: reply, branchId: null, isActive: true }],
  })
  const setActiveSession = vi.fn()
  const { result } = renderHook(() =>
    useSessionCopyWorkflow({
      activeSessionId: sessionId,
      activeWorkspace: workspace,
      messages: [
        {
          id: 'reply-row',
          role: 'assistant',
          parts: [{ type: 'text', content: 'Here is the answer' }],
          metadata: { sessionNodeId: 'reply-node' },
        },
      ],
      draftBranchSourceNodeId: null,
      model: SupportedModelId('openai/gpt-5.5'),
      navigate: vi.fn(),
      setActiveSession,
      loadSessions: vi.fn().mockResolvedValue(undefined),
      refreshSession: vi.fn().mockResolvedValue(undefined),
      refreshSessionWorkspace: vi.fn().mockResolvedValue(undefined),
      showToast: vi.fn(),
    }),
  )

  await act(() => result.current.forkResponseToNewSession('reply-row'))

  expect(apiMock.cloneSessionToNew).toHaveBeenCalledWith(
    sessionId,
    SupportedModelId('openai/gpt-5.5'),
    SessionNodeId('reply-node'),
  )
  expect(apiMock.forkSessionToNew).not.toHaveBeenCalledWith(
    sessionId,
    expect.anything(),
    expect.anything(),
  )
  expect(setActiveSession).toHaveBeenCalledWith(forkedSessionId)
  expect(useComposerStore.getState().input).toBe('')
})

function workflow(
  sessionId: SessionId,
  overrides: Partial<Parameters<typeof useSessionCopyWorkflow>[0]> = {},
) {
  return renderHook(() =>
    useSessionCopyWorkflow({
      activeSessionId: sessionId,
      activeWorkspace: null,
      messages: [
        {
          id: 'reply-row',
          role: 'assistant',
          parts: [{ type: 'text', content: 'Here is the answer' }],
          metadata: { sessionNodeId: 'reply-node' },
        },
      ],
      draftBranchSourceNodeId: null,
      model: SupportedModelId('openai/gpt-5.5'),
      navigate: vi.fn(),
      setActiveSession: vi.fn(),
      loadSessions: vi.fn().mockResolvedValue(undefined),
      refreshSession: vi.fn().mockResolvedValue(undefined),
      refreshSessionWorkspace: vi.fn().mockResolvedValue(undefined),
      showToast: vi.fn(),
      ...overrides,
    }),
  )
}

function hostWorkspace(sessionId: SessionId): SessionWorkspace {
  const reply = assistantNode('reply-node', sessionId)
  return fromPartial({
    tree: { session: { id: sessionId }, nodes: [reply], branches: [] },
    activeBranchId: null,
    activeNodeId: reply.id,
    transcriptPath: [{ node: reply, branchId: null, isActive: true }],
  })
}

it('reads a reply sent since the workspace loaded from the Host before forking after it', async () => {
  const sessionId = SessionId('session-live-reply')
  useChatStore.setState({ activeSessionId: sessionId, sessionById: new Map() })
  apiMock.getSessionWorkspace.mockReset().mockResolvedValue(hostWorkspace(sessionId))
  apiMock.cloneSessionToNew.mockReset().mockResolvedValue({ cancelled: true })
  // The loaded workspace predates the reply.
  const loaded: SessionWorkspace = fromPartial({
    tree: { session: { id: sessionId }, nodes: [], branches: [] },
    activeBranchId: null,
    activeNodeId: null,
    transcriptPath: [],
  })
  const { result } = workflow(sessionId, { activeWorkspace: loaded })

  await act(() => result.current.forkResponseToNewSession('reply-row'))

  expect(apiMock.getSessionWorkspace).toHaveBeenCalled()
  expect(apiMock.cloneSessionToNew).toHaveBeenCalledWith(
    sessionId,
    SupportedModelId('openai/gpt-5.5'),
    SessionNodeId('reply-node'),
  )
})

it('does not fork a Session the user left while its reply was read from the Host', async () => {
  const sessionId = SessionId('session-left')
  useChatStore.setState({ activeSessionId: sessionId, sessionById: new Map() })
  apiMock.getSessionWorkspace.mockReset().mockImplementation(async () => {
    useChatStore.setState({ activeSessionId: SessionId('session-elsewhere') })
    return hostWorkspace(sessionId)
  })
  apiMock.cloneSessionToNew.mockReset()
  const { result } = workflow(sessionId)

  await act(() => result.current.forkResponseToNewSession('reply-row'))

  expect(apiMock.cloneSessionToNew).not.toHaveBeenCalled()
})

it('makes one copy however often Fork is clicked while the first is on its way', async () => {
  const sessionId = SessionId('session-double-click')
  useChatStore.setState({ activeSessionId: sessionId, sessionById: new Map() })
  let finishRead: (workspace: SessionWorkspace) => void = () => undefined
  apiMock.getSessionWorkspace
    .mockReset()
    .mockImplementation(() => new Promise((resolve) => (finishRead = resolve)))
  apiMock.cloneSessionToNew.mockReset().mockResolvedValue({ cancelled: true })
  const { result } = workflow(sessionId)

  await act(async () => {
    const first = result.current.forkResponseToNewSession('reply-row')
    const second = result.current.forkResponseToNewSession('reply-row')
    finishRead(hostWorkspace(sessionId))
    await Promise.all([first, second])
  })

  expect(apiMock.getSessionWorkspace).toHaveBeenCalledTimes(1)
  expect(apiMock.cloneSessionToNew).toHaveBeenCalledTimes(1)
})

it('lets a copy run again after one that failed', async () => {
  const sessionId = SessionId('session-retry')
  useChatStore.setState({ activeSessionId: sessionId, sessionById: new Map() })
  apiMock.getSessionWorkspace.mockReset().mockResolvedValue(hostWorkspace(sessionId))
  apiMock.cloneSessionToNew.mockReset().mockRejectedValueOnce(new Error('Host stopped'))
  apiMock.cloneSessionToNew.mockResolvedValueOnce({ cancelled: true })
  const showToast = vi.fn()
  const { result } = workflow(sessionId, { showToast })

  await act(() => result.current.forkResponseToNewSession('reply-row'))
  await act(() => result.current.forkResponseToNewSession('reply-row'))

  expect(showToast).toHaveBeenCalledWith('Failed to fork session: Host stopped')
  expect(apiMock.cloneSessionToNew).toHaveBeenCalledTimes(2)
  expect(showToast).toHaveBeenLastCalledWith('Session fork cancelled.')
})
