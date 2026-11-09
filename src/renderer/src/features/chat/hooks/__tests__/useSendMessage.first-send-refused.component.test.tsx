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
    message: 'host_run_ceiling_reached',
    code: 'host_run_ceiling_reached',
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

const SESSION_ID = SessionId('created-session')
const MODEL = SupportedModelId('openai/gpt-5.4')

/** Sends the draft's first message into `created-session`; the Host refuses it. */
async function sendRefusedFirstMessage() {
  useChatStore.setState({
    sessionById: new Map([
      [
        SESSION_ID,
        {
          id: SESSION_ID,
          title: 'Created',
          projectPath: '/repo',
          messages: [],
          createdAt: 1,
          updatedAt: 1,
          executionModel: MODEL,
        },
      ],
    ]),
  })
  const { result } = renderHook(() =>
    useSendMessage({
      activeSessionId: null,
      model: MODEL,
      projectPath: '/repo',
      createSession: vi.fn(async () => SESSION_ID),
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

/*
 * The Host refused a new Session's first message before any Run started. The message goes back to
 * the composer, so it must leave the new Session's transcript, and there is no launch to recover.
 */
describe("a session's refused first send", () => {
  it('takes a refused first message out of the new Session, with no launch to recover', async () => {
    const failure = await sendRefusedFirstMessage()

    expect(failure).toBeInstanceOf(FirstSendFailed)
    const cause = failure instanceof FirstSendFailed ? failure.cause : undefined
    expect(cause).toBeInstanceOf(MessageNotDelivered)
    expect(cause).toMatchObject({ outcome: 'refused', code: 'host_run_ceiling_reached' })
    expect(
      useOptimisticUserMessageStore.getState().messagesBySessionId.get(SESSION_ID) ?? [],
    ).toEqual([])
    expect(useBackgroundRunStore.getState().firstSendRecoveryBySessionId.has(SESSION_ID)).toBe(
      false,
    )
  })

  it('keeps a refused first message for its worktree launch row, which owns it', async () => {
    useBackgroundRunStore.getState().setWorktreeLaunch(SESSION_ID, {
      status: 'failed',
      stage: 'preparing-workspace',
      startedAt: 1,
      updatedAt: 2,
      details: ['git worktree add failed'],
    })

    await sendRefusedFirstMessage()

    // Retry and Work locally rebuild the send from this; the composer does not take it back.
    expect(
      useBackgroundRunStore.getState().firstSendRecoveryBySessionId.get(SESSION_ID),
    ).toMatchObject({ payload: PAYLOAD })
    expect(
      useOptimisticUserMessageStore.getState().messagesBySessionId.get(SESSION_ID)?.length,
    ).toBe(1)
  })
})
