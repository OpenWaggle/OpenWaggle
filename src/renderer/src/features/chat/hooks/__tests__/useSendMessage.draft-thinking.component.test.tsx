import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { setSessionThinkingLevelMock, sendMessageMock } = vi.hoisted(() => ({
  setSessionThinkingLevelMock: vi.fn(async () => ({ changed: true as const })),
  sendMessageMock: vi.fn(async () => ({ outcome: 'delivered' as const })),
}))

vi.mock('@/features/project-actions', () => ({
  selectDraftWorkspacePreparation: vi.fn(async () => {}),
  validateDraftWorkspacePreparation: vi.fn(async () => 'default'),
}))
vi.mock('@/features/chat/state/draft-authorization-mode-store', () => ({
  flushDraftAuthorizationModeToSession: vi.fn(async () => {}),
}))
vi.mock('@/features/git', () => ({ snapshotDraftWorktreePlan: vi.fn(() => null) }))
vi.mock('@/shared/lib/ipc', () => ({
  api: { setSessionThinkingLevel: setSessionThinkingLevelMock, sendMessage: sendMessageMock },
}))

const { createSendHandlers, useSendMessage } = await import('../useSendMessage')
const { useChatStore } = await import('../../state/chat-store')
const thinkingWrites = await import('../../state/session-thinking-level-writes')
const foregroundSends = await import('../../state/foreground-send-store')

const PAYLOAD: AgentSendPayload = { text: 'review body', attachments: [] }
const CREATED = SessionId('created')

function handlers(defaultThinkingLevel?: 'medium' | 'low') {
  const createSession = vi.fn(async (..._args: unknown[]) => CREATED)
  const sendMessageToSession = vi.fn(async () => {})
  return {
    createSession,
    sendMessageToSession,
    send: createSendHandlers({
      activeSessionId: null,
      projectPath: '/repo',
      createSession,
      ...(defaultThinkingLevel ? { defaultThinkingLevel } : {}),
      sendMessage: vi.fn(async () => {}),
      sendMessageToSession,
      startWaggleCollaboration: vi.fn(),
      sendWaggleMessage: vi.fn(async () => {}),
    }),
  }
}

function pickDraftLevel(level: 'low' | 'high') {
  let finish: (() => void) | undefined
  void thinkingWrites.writeThinkingLevel({
    target: thinkingWrites.DEFAULT_THINKING_LEVEL_TARGET,
    level,
    write: () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    refresh: async () => {},
  })
  return () => finish?.()
}

describe("a draft's thinking level on first send", () => {
  beforeEach(() => {
    thinkingWrites.resetThinkingLevelWritesForTests()
    foregroundSends.resetForegroundSendsForTests()
    setSessionThinkingLevelMock.mockClear()
    sendMessageMock.mockClear()
  })

  it('creates the Session at the pick the draft shows, after the pick reached the default', async () => {
    const finishPick = pickDraftLevel('low')
    const { createSession, sendMessageToSession, send } = handlers('medium')

    const sent = send.handleSend(PAYLOAD)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(createSession).not.toHaveBeenCalled()
    finishPick()
    await sent

    expect(createSession).toHaveBeenCalledWith('/repo', undefined, 'low')
    // The level travels with the create; nothing writes it (or Pi's default) again afterwards.
    expect(setSessionThinkingLevelMock).not.toHaveBeenCalled()
    expect(sendMessageToSession).toHaveBeenCalledOnce()
  })

  it('creates the Session at the default the draft shows when there is no pick', async () => {
    const { createSession, send } = handlers('medium')

    await send.handleSend(PAYLOAD)

    expect(createSession).toHaveBeenCalledWith('/repo', undefined, 'medium')
  })

  it('leaves the level to the Host while the default is still unknown', async () => {
    const { createSession, send } = handlers()

    await send.handleSend(PAYLOAD)

    expect(createSession).toHaveBeenCalledWith('/repo', undefined, undefined)
  })

  it('does not carry a sent pick over to the next draft', async () => {
    const finishPick = pickDraftLevel('high')
    const first = handlers('medium')
    const sent = first.send.handleSend(PAYLOAD)
    await new Promise((resolve) => setTimeout(resolve, 0))
    finishPick()
    await sent
    expect(first.createSession).toHaveBeenCalledWith('/repo', undefined, 'high')

    // Another window changed the default meanwhile; the next draft shows and uses that.
    const next = handlers('low')
    await next.send.handleSend(PAYLOAD)
    expect(next.createSession).toHaveBeenCalledWith('/repo', undefined, 'low')
  })

  it('keeps the new Session locked from its creation until its first send settles', async () => {
    const { send, sendMessageToSession } = handlers('medium')
    const lockedDuringSend: boolean[] = []
    sendMessageToSession.mockImplementation(async () => {
      lockedDuringSend.push(foregroundSends.useForegroundSendStore.getState().counts.has(CREATED))
    })

    await send.handleSend(PAYLOAD)

    expect(lockedDuringSend).toEqual([true])
    expect(foregroundSends.useForegroundSendStore.getState().counts.has(CREATED)).toBe(false)
  })

  it('creates a Waggle draft at the level shown, too', async () => {
    const { createSession, send } = handlers('medium')

    await send.handleSendWaggle(PAYLOAD, {
      mode: 'sequential',
      agents: [],
      stop: { primary: 'consensus', maxTurnsSafety: 2 },
    })

    expect(createSession).toHaveBeenCalledWith('/repo', undefined, 'medium')
  })
  it("waits for the new Session's setting writes before the Host starts its first Run", async () => {
    const sessionId = SessionId('session-with-pending-write')
    const createdSession: SessionDetail = {
      id: sessionId,
      title: 'Created',
      projectPath: '/repo',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      executionModel: SupportedModelId('openai/gpt-5.5'),
    }
    let finishWrite: (() => void) | undefined
    const { result } = renderHook(() =>
      useSendMessage({
        activeSessionId: null,
        model: undefined,
        projectPath: '/repo',
        createSession: vi.fn(async () => {
          useChatStore.setState({ sessionById: new Map([[sessionId, createdSession]]) })
          // A write for the new Session already in flight when its first message goes out.
          void thinkingWrites.writeThinkingLevel({
            target: sessionId,
            level: 'high',
            write: () =>
              new Promise<void>((resolve) => {
                finishWrite = resolve
              }),
            refresh: async () => {},
          })
          return sessionId
        }),
        sendMessage: vi.fn(async () => {}),
        sendWaggleMessage: vi.fn(async () => {}),
      }),
    )

    let sent: Promise<void> | undefined
    act(() => {
      sent = result.current.handleSend(PAYLOAD)
    })
    await vi.waitFor(() => expect(finishWrite).toBeDefined())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sendMessageMock).not.toHaveBeenCalled()

    await act(async () => {
      finishWrite?.()
      await sent
    })
    expect(sendMessageMock).toHaveBeenCalledWith(sessionId, PAYLOAD, createdSession.executionModel)
  })
})
