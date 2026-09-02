import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { WaggleConfig } from '@shared/types/waggle'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWaggleStore } from '@/features/waggle/state'
import { useBackgroundRunStore } from '../../state/background-run-store'
import { useSendMessage } from '../useSendMessage'

const mocks = vi.hoisted(() => ({
  sendWaggleMessage: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    sendWaggleMessage: mocks.sendWaggleMessage,
  },
}))

const SESSION_A = SessionId('session-a')
const SESSION_B = SessionId('session-b')
const MODEL = SupportedModelId('openai/gpt-5.5')
const CONFIG = {
  mode: 'sequential',
  agents: [
    {
      label: 'Reviewer',
      model: MODEL,
      roleDescription: 'Reviews the change',
      color: 'blue',
    },
    {
      label: 'Verifier',
      model: MODEL,
      roleDescription: 'Verifies the change',
      color: 'amber',
    },
  ],
  stop: { primary: 'consensus', maxTurnsSafety: 2 },
} satisfies WaggleConfig

function deferredFailure() {
  let rejectPromise: ((error: Error) => void) | null = null
  const promise = new Promise<void>((_resolve, reject) => {
    rejectPromise = reject
  })
  return { promise, reject: (error: Error) => rejectPromise?.(error) }
}

describe('useSendMessage Waggle ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWaggleStore.getState().reset()
    useBackgroundRunStore.setState({
      renderSnapshotsBySessionId: new Map(),
      firstSendRecoveryBySessionId: new Map(),
    })
  })

  it('does not stop a newer session when an earlier first-message send fails', async () => {
    const pending = deferredFailure()
    mocks.sendWaggleMessage.mockReturnValueOnce(pending.promise)
    const { result } = renderHook(() =>
      useSendMessage({
        activeSessionId: null,
        model: MODEL,
        projectPath: '/project',
        thinkingLevel: 'medium',
        createSession: vi.fn().mockResolvedValue(SESSION_A),
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendWaggleMessage: vi.fn().mockResolvedValue(undefined),
      }),
    )

    /*
     * Observed, because a failed first send now rejects: it names the session it created so a caller holding
     * submitted work - a review - can follow it there rather than lose it. Left unobserved the rejection
     * surfaces as an unhandled error and says nothing about the ownership this test is about.
     */
    let sendFailure: unknown = null
    const sending = result.current
      .handleSendWaggle(
        {
          text: 'Review this',
          thinkingLevel: 'medium',
          attachments: [],
        },
        CONFIG,
      )
      .catch((error: unknown) => {
        sendFailure = error
      })
    await vi.waitFor(() => expect(mocks.sendWaggleMessage).toHaveBeenCalledOnce())
    useWaggleStore.getState().startCollaboration(SESSION_B, CONFIG)
    await act(async () => {
      pending.reject(new Error('session A failed'))
      await Promise.resolve()
      await Promise.resolve()
    })
    await sending
    await vi.waitFor(() =>
      expect(
        useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_A)?.messages,
      ).toHaveLength(1),
    )

    expect(sendFailure).toMatchObject({ createdSessionId: SESSION_A })
    expect(useWaggleStore.getState().activeCollaborationId).toBe(SESSION_B)
    expect(useWaggleStore.getState().status).toBe('pending')
  })
})
