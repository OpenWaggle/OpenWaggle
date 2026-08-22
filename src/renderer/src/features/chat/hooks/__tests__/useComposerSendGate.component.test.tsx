import type { AgentSendPayload } from '@shared/types/agent'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { useSessionContextRowMock, stashDraftWorktreePlanMock } = vi.hoisted(() => ({
  useSessionContextRowMock: vi.fn(),
  stashDraftWorktreePlanMock: vi.fn(),
}))

vi.mock('@/features/git', () => ({
  useSessionContextRow: useSessionContextRowMock,
  stashDraftWorktreePlan: stashDraftWorktreePlanMock,
}))

vi.mock('@/features/settings/state', () => ({
  usePreferencesStore: (selector: (state: unknown) => unknown) =>
    selector({ settings: { projectPath: '/repo', defaultSessionEnvironmentMode: 'worktree' } }),
}))

const { useComposerSendGate } = await import('../useComposerSendGate')

const PAYLOAD: AgentSendPayload = {
  text: 'do the thing',
  thinkingLevel: 'off',
  attachments: [],
}

function stripWith(sendPlan: { kind: string; reason?: string }) {
  return {
    sendPlan,
    envMode: 'worktree',
    baseRef: 'main',
    startFromOrigin: false,
  }
}

describe('useComposerSendGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports why sending is refused when the session worktree has vanished', () => {
    /*
     * The reason is exposed, not just acted on inside the send path, so queueing can be gated by
     * the same rule. A queued message is dispatched later with the raw send, so queueing was a way
     * straight past this gate: main then rejected it with a bare thrown error - its own comment
     * says reaching there means something bypassed the gate - and the message was re-enqueued
     * instead of the user seeing the recover-or-switch notice.
     */
    useSessionContextRowMock.mockReturnValue(
      stripWith({ kind: 'worktree-missing', reason: 'This session\u2019s worktree is gone.' }),
    )
    const onToast = vi.fn()
    const onSend = vi.fn(async () => {})

    const { result } = renderHook(() =>
      useComposerSendGate({
        activeSessionId: null,
        session: null,
        isFirstMessage: false,
        onSend,
        onToast,
      }),
    )

    expect(result.current.sendBlockedReason).toBe('This session\u2019s worktree is gone.')
  })

  it('refuses the send itself and reports the reason once', async () => {
    useSessionContextRowMock.mockReturnValue(
      stripWith({ kind: 'blocked', reason: 'No base branch is resolvable.' }),
    )
    const onToast = vi.fn()
    const onSend = vi.fn(async () => {})

    const { result } = renderHook(() =>
      useComposerSendGate({
        activeSessionId: null,
        session: null,
        isFirstMessage: true,
        onSend,
        onToast,
      }),
    )
    await result.current.guardedSend(PAYLOAD)

    expect(onSend).not.toHaveBeenCalled()
    expect(onToast).toHaveBeenCalledWith('No base branch is resolvable.')
  })

  it('allows sending when the plan is not blocking', async () => {
    useSessionContextRowMock.mockReturnValue(stripWith({ kind: 'proceed' }))
    const onSend = vi.fn(async () => {})

    const { result } = renderHook(() =>
      useComposerSendGate({
        activeSessionId: null,
        session: null,
        isFirstMessage: true,
        onSend,
        onToast: vi.fn(),
      }),
    )
    await result.current.guardedSend(PAYLOAD)

    expect(result.current.sendBlockedReason).toBeNull()
    expect(onSend).toHaveBeenCalledWith(PAYLOAD)
  })
})
