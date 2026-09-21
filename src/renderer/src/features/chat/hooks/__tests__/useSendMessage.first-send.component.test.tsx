import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FirstSendFailed } from '../../lib/message-delivery'
import { useChatStore } from '../../state/chat-store'

const { flushDraftAuthorizationModeMock, sendMessageMock, snapshotDraftWorktreePlanMock } =
  vi.hoisted(() => ({
    flushDraftAuthorizationModeMock: vi.fn(async () => {}),
    sendMessageMock: vi.fn(async () => ({ outcome: 'delivered' as const })),
    snapshotDraftWorktreePlanMock: vi.fn(() => ({
      projectPath: '/repo',
      plan: { envMode: 'worktree' as const, baseRef: 'main' },
    })),
  }))

vi.mock('@/features/chat/state/draft-authorization-mode-store', () => ({
  flushDraftAuthorizationModeToSession: flushDraftAuthorizationModeMock,
}))

vi.mock('@/features/git', () => ({
  snapshotDraftWorktreePlan: snapshotDraftWorktreePlanMock,
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: { sendMessage: sendMessageMock, sendWaggleMessage: vi.fn() },
}))

const { createSendHandlers, useSendMessage } = await import('../useSendMessage')

const PAYLOAD: AgentSendPayload = { text: 'review body', thinkingLevel: 'off', attachments: [] }

describe("a session's first send", () => {
  beforeEach(() => {
    flushDraftAuthorizationModeMock.mockReset().mockResolvedValue(undefined)
    sendMessageMock.mockClear()
    snapshotDraftWorktreePlanMock.mockClear()
    useChatStore.setState({ sessionById: new Map() })
  })

  it('persists an explicit draft authorization override before dispatching the turn', async () => {
    const createSession = vi.fn(async () => SessionId('session-a'))
    const sendMessageToSession = vi.fn(async () => {})
    const handlers = createSendHandlers({
      activeSessionId: null,
      projectPath: '/repo',
      thinkingLevel: 'off',
      createSession,
      sendMessage: vi.fn(async () => {}),
      sendMessageToSession,
      startWaggleCollaboration: vi.fn(),
      sendWaggleMessage: vi.fn(async () => {}),
    })

    await handlers.handleSend(PAYLOAD)

    expect(createSession).toHaveBeenCalledWith('/repo', {
      environmentMode: 'worktree',
      baseRef: 'main',
      startFromOrigin: false,
    })
    expect(snapshotDraftWorktreePlanMock.mock.invocationCallOrder[0]).toBeLessThan(
      createSession.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
    expect(flushDraftAuthorizationModeMock).toHaveBeenCalledWith('/repo', SessionId('session-a'))
    expect(flushDraftAuthorizationModeMock.mock.invocationCallOrder[0]).toBeLessThan(
      sendMessageToSession.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
  })

  it('propagates a failure instead of reporting success', async () => {
    /*
     * The first send was dispatched fire-and-forget and its error swallowed, so the caller was told the
     * send had succeeded. A review submitted as a session's first message was therefore cleared and never
     * restored - the restore only runs when the promise rejects.
     */
    const handlers = createSendHandlers({
      activeSessionId: null,
      projectPath: '/repo',
      thinkingLevel: 'off',
      createSession: vi.fn(async () => SessionId('session-a')),
      sendMessage: vi.fn(async () => {}),
      sendMessageToSession: vi.fn(async () => {
        throw new Error("This session's worktree no longer exists.")
      }),
      startWaggleCollaboration: vi.fn(),
      sendWaggleMessage: vi.fn(async () => {}),
    })

    await expect(handlers.handleSend(PAYLOAD)).rejects.toThrow(/worktree no longer exists/)
  })

  it('dispatches with the immutable model returned by creation, not a stale render', async () => {
    const sessionId = SessionId('created-session')
    const draftModel = SupportedModelId('openai/gpt-5.4')
    const staleRenderModel = SupportedModelId('anthropic/claude-sonnet-4')
    const createdSession: SessionDetail = {
      id: sessionId,
      title: 'Created',
      projectPath: '/repo',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      executionModel: draftModel,
    }
    const { result } = renderHook(() =>
      useSendMessage({
        activeSessionId: null,
        model: staleRenderModel,
        projectPath: '/repo',
        thinkingLevel: 'off',
        createSession: vi.fn(async () => {
          useChatStore.setState({ sessionById: new Map([[sessionId, createdSession]]) })
          return sessionId
        }),
        sendMessage: vi.fn(async () => {}),
        sendWaggleMessage: vi.fn(async () => {}),
      }),
    )

    await act(() => result.current.handleSend(PAYLOAD))

    expect(sendMessageMock).toHaveBeenCalledWith(sessionId, PAYLOAD, draftModel)
  })

  it('attributes an authorization setup failure to the newly created session', async () => {
    const failure = new Error('authorization setup failed')
    flushDraftAuthorizationModeMock.mockRejectedValueOnce(failure)
    const sendMessageToSession = vi.fn(async () => {})
    const handlers = createSendHandlers({
      activeSessionId: null,
      projectPath: '/repo',
      thinkingLevel: 'off',
      createSession: vi.fn(async () => SessionId('created-session')),
      sendMessage: vi.fn(async () => {}),
      sendMessageToSession,
      startWaggleCollaboration: vi.fn(),
      sendWaggleMessage: vi.fn(async () => {}),
    })

    await expect(handlers.handleSend(PAYLOAD)).rejects.toMatchObject({
      createdSessionId: 'created-session',
      cause: failure,
    } satisfies Partial<FirstSendFailed>)
    expect(sendMessageToSession).not.toHaveBeenCalled()
  })
})
