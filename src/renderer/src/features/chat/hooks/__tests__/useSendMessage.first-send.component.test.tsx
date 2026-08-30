import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId } from '@shared/types/brand'
import type { SessionWorktreePlan } from '@shared/types/session'
import { describe, expect, it, vi } from 'vitest'

const { consumeDraftWorktreePlanMock, flushDraftAuthorizationModeMock } = vi.hoisted(() => ({
  consumeDraftWorktreePlanMock: vi.fn<(projectPath: string) => SessionWorktreePlan | undefined>(
    () => undefined,
  ),
  flushDraftAuthorizationModeMock: vi.fn(async () => {}),
}))

vi.mock('@/features/chat/state/draft-authorization-mode-store', () => ({
  flushDraftAuthorizationModeToSession: flushDraftAuthorizationModeMock,
}))

vi.mock('@/features/git', () => ({
  consumeDraftWorktreePlan: consumeDraftWorktreePlanMock,
}))

const { createSendHandlers } = await import('../useSendMessage')

const PAYLOAD: AgentSendPayload = { text: 'review body', thinkingLevel: 'off', attachments: [] }

describe("a session's first send", () => {
  it('persists an explicit draft authorization override before dispatching the turn', async () => {
    const worktreePlan = {
      environmentMode: 'worktree' as const,
      baseRef: 'main',
      startFromOrigin: true,
    }
    consumeDraftWorktreePlanMock.mockReturnValueOnce(worktreePlan)
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

    expect(createSession).toHaveBeenCalledWith('/repo', worktreePlan)
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
})
