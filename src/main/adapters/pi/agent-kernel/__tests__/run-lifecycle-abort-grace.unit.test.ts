import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentKernelRunInput } from '../../../../ports/agent-kernel-service'
import { PI_ABORTED_RUN_SETTLE_GRACE_MS } from '../pi-run-abort'
import { runSubscribedPiOperation } from '../run-lifecycle'

const POST_RUN_SETTLE_MAX_MS = 15_000

vi.mock('../../pi-session-lifecycle', () => ({
  createOpenWaggleAgentSessionFromServices: vi.fn(),
  disposeOpenWagglePiSession: vi.fn(async () => undefined),
}))

type PiAgentMessage = AgentSession['agent']['state']['messages'][number]

function runInput(signal: AbortSignal): AgentKernelRunInput {
  return {
    session: {
      id: SessionId('abort-grace-session'),
      title: 'Abort grace',
      projectPath: '/repo',
      piSessionId: 'pi-session-abort-grace',
      piSessionFile: '/repo/.pi/session.jsonl',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
    },
    runId: 'run-abort-grace',
    payload: { text: 'Continue', attachments: [] },
    model: SupportedModelId('openai/gpt-5.5'),
    signal,
    onEvent: vi.fn(),
  }
}

/**
 * A Pi session that stays busy: `isStreaming` is true until the operation returns, as it is while
 * Pi runs agent_before_settle handlers. `loopSignal` is Pi's agent-loop signal, absent once the loop
 * returned.
 */
function busySession(loopSignal: AbortSignal | undefined) {
  const state: { messages: PiAgentMessage[] } = { messages: [] }
  return {
    sessionId: 'pi-session-abort-grace',
    sessionFile: '/repo/.pi/session.jsonl',
    agent: {
      state,
      signal: loopSignal,
      waitForIdle: vi.fn(async () => undefined),
      hasQueuedMessages: vi.fn(() => false),
    },
    sessionManager: { getEntries: () => [], getBranch: () => [], getLeafId: () => null },
    abort: vi.fn(async () => undefined),
    isCompacting: false,
    isStreaming: true,
  }
}

function runUntilStopped(session: ReturnType<typeof busySession>, operation: () => Promise<void>) {
  const controller = new AbortController()
  const outcome = { settled: false }
  const result = runSubscribedPiOperation({
    runInput: runInput(controller.signal),
    session: fromPartial<AgentSession>(session),
    unsubscribe: vi.fn(),
    abortWarning: 'abort failed',
    preAbortWarning: 'pre-abort failed',
    operation,
    buildErrorMessages: () => [],
  }).finally(() => {
    outcome.settled = true
  })
  controller.abort()
  return { result, outcome }
}

describe('a stopped Run whose Pi work ignores the abort', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /*
   * Pi runs agent_before_settle handlers after its agent loop returned. Stop aborts their signal,
   * but a handler that ignores it held the Run in "Finishing" until it returned, for minutes.
   */
  it('settles after the grace once the agent loop has returned', async () => {
    vi.useFakeTimers()
    const session = busySession(undefined)
    // A before-settle handler that never returns.
    const { result, outcome } = runUntilStopped(session, () => new Promise<void>(() => undefined))

    await vi.advanceTimersByTimeAsync(PI_ABORTED_RUN_SETTLE_GRACE_MS - 1)
    expect(outcome.settled).toBe(false)
    expect(session.abort).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(1)
    const settled = await result

    expect('aborted' in settled ? settled.aborted : undefined).toBe(true)
    // Nor does it wait for a Pi settlement that is not coming.
    expect(session.agent.waitForIdle).not.toHaveBeenCalled()
  })

  it('keeps waiting while the agent loop still runs, since a tool may yet write its result', async () => {
    vi.useFakeTimers()
    const session = busySession(new AbortController().signal)
    let finishOperation = () => {}
    const { result, outcome } = runUntilStopped(
      session,
      () =>
        new Promise<void>((resolve) => {
          finishOperation = resolve
        }),
    )

    await vi.advanceTimersByTimeAsync(PI_ABORTED_RUN_SETTLE_GRACE_MS * 3)
    expect(outcome.settled).toBe(false)

    finishOperation()
    await vi.advanceTimersByTimeAsync(POST_RUN_SETTLE_MAX_MS)
    await result
    expect(outcome.settled).toBe(true)
  })
})
