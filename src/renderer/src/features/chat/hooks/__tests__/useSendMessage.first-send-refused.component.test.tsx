import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FirstSendFailed, MessageNotDelivered } from '../../lib/message-delivery'
import { useBackgroundRunStore } from '../../state/background-run-store'
import { useChatStore } from '../../state/chat-store'
import { useOptimisticUserMessageStore } from '../../state/optimistic-user-message-store'

const { sendMessageMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(async () => ({
    outcome: 'refused' as const,
    message: 'queue_capacity_reached',
    code: 'queue_capacity_reached',
  })),
}))

vi.mock('@/features/project-actions', () => ({
  selectDraftWorkspacePreparation: vi.fn(async () => {}),
  validateDraftWorkspacePreparation: vi.fn(async () => null),
}))

vi.mock('@/features/chat/state/draft-authorization-mode-store', () => ({
  flushDraftAuthorizationModeToSession: vi.fn(async () => {}),
}))

vi.mock('@/features/git', () => ({ snapshotDraftWorktreePlan: vi.fn(() => null) }))

vi.mock('@/shared/lib/ipc', () => ({
  api: { sendMessage: sendMessageMock, sendWaggleMessage: vi.fn() },
}))

const { useSendMessage } = await import('../useSendMessage')

const PAYLOAD: AgentSendPayload = { text: 'review body', attachments: [] }

/*
 * The Host refused a new Session's first message before any Run started. The message goes back to
 * the composer, so it must leave the new Session's transcript, and there is no launch to recover.
 */
/** A first send from a draft, into the Session it creates, that the Host refuses. */
async function refusedFirstSend(sessionId: SessionId, beforeSend?: () => void) {
  const model = SupportedModelId('openai/gpt-5.4')
  useChatStore.setState({
    sessionById: new Map([
      [
        sessionId,
        {
          id: sessionId,
          title: 'Created',
          projectPath: '/repo',
          messages: [],
          createdAt: 1,
          updatedAt: 1,
          executionModel: model,
        },
      ],
    ]),
  })
  const { result } = renderHook(() =>
    useSendMessage({
      activeSessionId: null,
      model,
      projectPath: '/repo',
      createSession: vi.fn(async () => {
        beforeSend?.()
        return sessionId
      }),
      sendMessage: vi.fn(async () => {}),
      sendWaggleMessage: vi.fn(async () => {}),
    }),
  )
  let failure: unknown
  await act(async () => {
    await result.current.handleSend(PAYLOAD).catch((error: unknown) => {
      failure = error
    })
  })
  return failure
}

describe("a session's refused first send", () => {
  it('takes a refused first message out of the new Session, with no launch to recover', async () => {
    const sessionId = SessionId('created-session')
    const failure = await refusedFirstSend(sessionId)

    expect(failure).toBeInstanceOf(FirstSendFailed)
    const cause = failure instanceof FirstSendFailed ? failure.cause : undefined
    expect(cause).toBeInstanceOf(MessageNotDelivered)
    expect(cause).toMatchObject({ outcome: 'refused', code: 'queue_capacity_reached' })
    expect(
      useOptimisticUserMessageStore.getState().messagesBySessionId.get(sessionId) ?? [],
    ).toEqual([])
    expect(useBackgroundRunStore.getState().firstSendRecoveryBySessionId.has(sessionId)).toBe(false)
  })

  // A failed worktree birth is reported refused too; its row offers Retry, which needs the send.
  it('keeps the recovery of a refused first send whose worktree launch failed', async () => {
    const sessionId = SessionId('created-worktree-session')
    await refusedFirstSend(sessionId, () => {
      useBackgroundRunStore.getState().setWorktreeLaunch(sessionId, {
        status: 'failed',
        stage: 'checking-out-files',
        startedAt: 1,
        updatedAt: 2,
        details: ['git worktree add failed'],
      })
    })

    expect(
      useBackgroundRunStore.getState().firstSendRecoveryBySessionId.get(sessionId),
    ).toMatchObject({
      payload: PAYLOAD,
    })
  })
})
