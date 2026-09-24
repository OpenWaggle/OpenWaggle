import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import type { WaggleConfig } from '@shared/types/waggle'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FirstSendFailed } from '../../lib/message-delivery'
import { useChatStore } from '../../state/chat-store'

const {
  flushDraftAuthorizationModeMock,
  selectPreparationMock,
  validatePreparationMock,
  sendMessageMock,
  snapshotDraftWorktreePlanMock,
} = vi.hoisted(() => ({
  flushDraftAuthorizationModeMock: vi.fn(async () => {}),
  selectPreparationMock: vi.fn(async () => {}),
  validatePreparationMock: vi.fn(
    async (_projectPath: string, profileId: string | undefined) => profileId ?? 'default',
  ),
  sendMessageMock: vi.fn(async () => ({ outcome: 'delivered' as const })),
  snapshotDraftWorktreePlanMock: vi.fn<
    () => {
      projectPath: string
      plan: { envMode: 'worktree'; baseRef: string; preparationProfileId?: string }
    }
  >(() => ({
    projectPath: '/repo',
    plan: { envMode: 'worktree' as const, baseRef: 'main' },
  })),
}))

vi.mock('@/features/project-actions', () => ({
  selectDraftWorkspacePreparation: selectPreparationMock,
  validateDraftWorkspacePreparation: validatePreparationMock,
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
const WAGGLE_CONFIG: WaggleConfig = {
  mode: 'sequential',
  agents: [
    {
      label: 'Planner',
      model: SupportedModelId('openai/gpt-5.5'),
      roleDescription: 'Plan the work',
      color: 'blue',
    },
    {
      label: 'Reviewer',
      model: SupportedModelId('anthropic/claude-sonnet-4-5'),
      roleDescription: 'Review the work',
      color: 'amber',
    },
  ],
  stop: { primary: 'consensus', maxTurnsSafety: 2 },
}

describe("a session's first send", () => {
  beforeEach(() => {
    flushDraftAuthorizationModeMock.mockReset().mockResolvedValue(undefined)
    selectPreparationMock.mockReset().mockResolvedValue(undefined)
    validatePreparationMock
      .mockReset()
      .mockImplementation(
        async (_projectPath: string, profileId: string | undefined) => profileId ?? 'default',
      )
    sendMessageMock.mockClear()
    snapshotDraftWorktreePlanMock
      .mockReset()
      .mockReturnValue({ projectPath: '/repo', plan: { envMode: 'worktree', baseRef: 'main' } })
    useChatStore.setState({ sessionById: new Map() })
  })

  it('persists the chosen profile before the first turn and retains the new session on preparation failure', async () => {
    snapshotDraftWorktreePlanMock.mockReturnValue({
      projectPath: '/repo',
      plan: { envMode: 'worktree', baseRef: 'main', preparationProfileId: 'frontend' },
    })
    const sendMessageToSession = vi.fn(async () => {})
    const handlers = createSendHandlers({
      activeSessionId: null,
      projectPath: '/repo',
      thinkingLevel: 'off',
      createSession: vi.fn(async () => SessionId('created')),
      sendMessage: vi.fn(async () => {}),
      sendMessageToSession,
      startWaggleCollaboration: vi.fn(),
      sendWaggleMessage: vi.fn(async () => {}),
    })
    selectPreparationMock.mockRejectedValueOnce(new Error('Profile was removed'))
    await expect(handlers.handleSend(PAYLOAD)).rejects.toMatchObject({
      createdSessionId: 'created',
    })
    expect(selectPreparationMock).toHaveBeenCalledWith('/repo', 'created', 'frontend')
    expect(validatePreparationMock).toHaveBeenCalledWith('/repo', 'frontend')
    expect(sendMessageToSession).not.toHaveBeenCalled()
    await handlers.handleSend(PAYLOAD)
    expect(selectPreparationMock.mock.invocationCallOrder.at(-1)).toBeLessThan(
      sendMessageToSession.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
  })

  it.each(['classic', 'waggle'])(
    'does not create a %s Session until its profile is valid',
    async (mode) => {
      const createSession = vi.fn(async () => SessionId('created'))
      const sendMessageToSession = vi.fn(async () => {})
      const startWaggleCollaboration = vi.fn()
      const handlers = createSendHandlers({
        activeSessionId: null,
        projectPath: '/repo',
        thinkingLevel: 'off',
        createSession,
        sendMessage: vi.fn(async () => {}),
        sendMessageToSession,
        startWaggleCollaboration,
        sendWaggleMessage: vi.fn(async () => {}),
      })
      validatePreparationMock.mockRejectedValueOnce(
        new Error('Choose a Preparation profile for this worktree before sending.'),
      )

      const send = () =>
        mode === 'classic'
          ? handlers.handleSend(PAYLOAD)
          : handlers.handleSendWaggle(PAYLOAD, WAGGLE_CONFIG)
      await expect(send()).rejects.toThrow('Choose a Preparation profile')
      expect(createSession).not.toHaveBeenCalled()
      expect(sendMessageToSession).not.toHaveBeenCalled()
      expect(startWaggleCollaboration).not.toHaveBeenCalled()
      expect(validatePreparationMock).toHaveBeenCalledWith('/repo', undefined)
    },
  )

  it.each(['classic', 'waggle'])(
    'pins the sole preflighted profile across %s Session creation',
    async (mode) => {
      const sendMessageToSession = vi.fn(async () => {})
      const handlers = createSendHandlers({
        activeSessionId: null,
        projectPath: '/repo',
        thinkingLevel: 'off',
        createSession: vi.fn(async () => SessionId('created')),
        sendMessage: vi.fn(async () => {}),
        sendMessageToSession,
        startWaggleCollaboration: vi.fn(),
        sendWaggleMessage: vi.fn(async () => {}),
      })
      validatePreparationMock.mockResolvedValueOnce('default')

      if (mode === 'classic') await handlers.handleSend(PAYLOAD)
      else await handlers.handleSendWaggle(PAYLOAD, WAGGLE_CONFIG)

      expect(validatePreparationMock).toHaveBeenCalledWith('/repo', undefined)
      expect(selectPreparationMock).toHaveBeenCalledWith('/repo', 'created', 'default')
      expect(selectPreparationMock.mock.invocationCallOrder[0]).toBeLessThan(
        sendMessageToSession.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      )
    },
  )

  it('waits for preparation discovery before creating the first Session', async () => {
    let finishValidation: () => void = () => {}
    validatePreparationMock.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finishValidation = () => resolve('default')
      }),
    )
    const createSession = vi.fn(async () => SessionId('created'))
    const handlers = createSendHandlers({
      activeSessionId: null,
      projectPath: '/repo',
      thinkingLevel: 'off',
      createSession,
      sendMessage: vi.fn(async () => {}),
      sendMessageToSession: vi.fn(async () => {}),
      startWaggleCollaboration: vi.fn(),
      sendWaggleMessage: vi.fn(async () => {}),
    })

    const sending = handlers.handleSend(PAYLOAD)
    expect(createSession).not.toHaveBeenCalled()
    finishValidation()
    await sending
    expect(createSession).toHaveBeenCalledOnce()
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
