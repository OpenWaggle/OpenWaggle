import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { setSessionThinkingLevelMock } = vi.hoisted(() => ({
  setSessionThinkingLevelMock: vi.fn(async () => ({ changed: true as const })),
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
  api: { setSessionThinkingLevel: setSessionThinkingLevelMock },
}))

const { createSendHandlers } = await import('../useSendMessage')
const thinkingWrites = await import('../../state/session-thinking-level-writes')

const PAYLOAD: AgentSendPayload = { text: 'review body', attachments: [] }

function handlers() {
  const createSession = vi.fn(async () => SessionId('created'))
  const sendMessageToSession = vi.fn(async () => {})
  return {
    createSession,
    sendMessageToSession,
    send: createSendHandlers({
      activeSessionId: null,
      projectPath: '/repo',
      createSession,
      sendMessage: vi.fn(async () => {}),
      sendMessageToSession,
      startWaggleCollaboration: vi.fn(),
      sendWaggleMessage: vi.fn(async () => {}),
    }),
  }
}

describe("a draft's thinking pick on first send", () => {
  beforeEach(() => {
    thinkingWrites.resetThinkingLevelWritesForTests()
    setSessionThinkingLevelMock.mockClear()
  })

  it('waits for the pick, then stores it on the new Session before the first turn', async () => {
    let finishDefaultWrite: (() => void) | undefined
    void thinkingWrites.writeThinkingLevel({
      target: thinkingWrites.DEFAULT_THINKING_LEVEL_TARGET,
      level: 'low',
      write: () =>
        new Promise<void>((resolve) => {
          finishDefaultWrite = resolve
        }),
      refresh: async () => {},
    })
    const { createSession, sendMessageToSession, send } = handlers()

    const sent = send.handleSend(PAYLOAD)
    await new Promise((resolve) => setTimeout(resolve, 0))
    // The new Session reads Pi's default when it is created, so it must not exist yet.
    expect(createSession).not.toHaveBeenCalled()
    finishDefaultWrite?.()
    await sent

    expect(setSessionThinkingLevelMock).toHaveBeenCalledWith('created', 'low')
    expect(createSession.mock.invocationCallOrder[0]).toBeLessThan(
      setSessionThinkingLevelMock.mock.invocationCallOrder[0] ?? 0,
    )
    expect(setSessionThinkingLevelMock.mock.invocationCallOrder[0]).toBeLessThan(
      sendMessageToSession.mock.invocationCallOrder[0] ?? 0,
    )

    // The pick belongs to that Session; the next draft starts from the default again.
    await send.handleSend(PAYLOAD)
    expect(setSessionThinkingLevelMock).toHaveBeenCalledTimes(1)
  })

  it('leaves a new Session on the default it started from when the draft had no pick', async () => {
    const { sendMessageToSession, send } = handlers()

    await send.handleSend(PAYLOAD)

    expect(setSessionThinkingLevelMock).not.toHaveBeenCalled()
    expect(sendMessageToSession).toHaveBeenCalledOnce()
  })
})
