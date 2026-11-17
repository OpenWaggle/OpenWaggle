import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId } from '@shared/types/brand'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearInlineVisualizationStatesForTests,
  reportInlineVisualizationState,
} from '../../state/inline-visualization-state'

const { useSessionContextRowMock, stashDraftWorktreePlanMock, settledWorktreePlanWriteMock } =
  vi.hoisted(() => ({
    useSessionContextRowMock: vi.fn(),
    stashDraftWorktreePlanMock: vi.fn(),
    settledWorktreePlanWriteMock: vi.fn(async () => {}),
  }))

vi.mock('@/features/git', () => ({
  useSessionContextRow: useSessionContextRowMock,
  stashDraftWorktreePlan: stashDraftWorktreePlanMock,
  settledWorktreePlanWrite: settledWorktreePlanWriteMock,
  worktreePlanKey: (input: { sessionId: string | null; projectPath: string | null }) =>
    input.sessionId ?? `draft:${input.projectPath}`,
}))

vi.mock('@/features/settings/state', () => ({
  usePreferencesStore: (selector: (state: unknown) => unknown) =>
    selector({ settings: { projectPath: '/repo', defaultSessionEnvironmentMode: 'worktree' } }),
}))

const { useComposerSendGate } = await import('../useComposerSendGate')

const PAYLOAD: AgentSendPayload = {
  text: 'do the thing',
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

  afterEach(clearInlineVisualizationStatesForTests)

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
    expect(result.current.guardedSend(PAYLOAD)).toBe(false)

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

  it('waits for a base-ref pick to reach the Host before it sends', async () => {
    /*
     * A pick on an existing Session is a Session Control handoff, so the plan the Host knows
     * changes one round trip later. A send that overtook it forked the first worktree from the
     * previous base ref, which is the reported "my branch selection was ignored".
     */
    const activeSessionId = SessionId('session-a')
    useSessionContextRowMock.mockReturnValue(stripWith({ kind: 'proceed' }))
    let releasePick = () => {}
    settledWorktreePlanWriteMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releasePick = resolve)),
    )
    const onSend = vi.fn(async () => {})
    const { result } = renderHook(() =>
      useComposerSendGate({
        activeSessionId,
        session: null,
        isFirstMessage: false,
        onSend,
        onToast: vi.fn(),
      }),
    )

    const sending = result.current.guardedSend(PAYLOAD)
    await Promise.resolve()
    expect(onSend).not.toHaveBeenCalled()
    expect(settledWorktreePlanWriteMock).toHaveBeenCalledWith(String(activeSessionId))

    releasePick()
    await sending
    expect(onSend).toHaveBeenCalledOnce()
  })

  it('attaches the latest mounted visualization state to an active-session send', async () => {
    const activeSessionId = SessionId('session-a')
    useSessionContextRowMock.mockReturnValue(stripWith({ kind: 'proceed' }))
    reportInlineVisualizationState({
      instanceId: 'frame-a',
      sessionId: activeSessionId,
      sourcePath: '/repo/map.html',
      title: 'Map',
      state: { selected: 'api' },
    })
    const onSend = vi.fn(async () => {})
    const { result } = renderHook(() =>
      useComposerSendGate({
        activeSessionId,
        session: null,
        isFirstMessage: false,
        onSend,
        onToast: vi.fn(),
      }),
    )

    await result.current.guardedSend(PAYLOAD)

    expect(onSend).toHaveBeenCalledWith({
      ...PAYLOAD,
      visualizationContext: {
        title: 'Map',
        sourcePath: '/repo/map.html',
        state: { selected: 'api' },
      },
    })
  })
})
