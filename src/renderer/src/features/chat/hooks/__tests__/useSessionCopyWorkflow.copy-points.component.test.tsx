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
