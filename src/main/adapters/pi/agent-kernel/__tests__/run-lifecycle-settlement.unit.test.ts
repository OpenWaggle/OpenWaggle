import type { AgentSession } from '@mariozechner/pi-coding-agent'
import type { HydratedAgentSendPayload } from '@shared/types/agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentKernelRunInput } from '../../../../ports/agent-kernel-service'
import { runSubscribedPiOperation } from '../run-lifecycle'

const POST_RUN_SETTLE_MAX_MS = 15_000

const lifecycleMocks = vi.hoisted(() => ({
  disposeOpenWagglePiSession: vi.fn(async () => undefined),
}))

vi.mock('../../pi-session-lifecycle', () => ({
  createOpenWaggleAgentSessionFromServices: vi.fn(),
  disposeOpenWagglePiSession: lifecycleMocks.disposeOpenWagglePiSession,
}))

type PiAgentMessage = AgentSession['agent']['state']['messages'][number]

interface FakeAgentState {
  messages: PiAgentMessage[]
}

interface FakeSession {
  readonly sessionId: string
  readonly sessionFile: string
  readonly agent: {
    readonly state: FakeAgentState
    readonly waitForIdle: () => Promise<void>
    readonly hasQueuedMessages: () => boolean
  }
  readonly sessionManager: {
    readonly getEntries: () => readonly unknown[]
    readonly getLeafId: () => string | null
  }
  readonly abort: () => Promise<void>
  readonly isCompacting: boolean
  readonly isStreaming: boolean
}

function sessionDetail(): SessionDetail {
  return {
    id: SessionId('run-lifecycle-session'),
    title: 'Run lifecycle',
    projectPath: '/repo',
    piSessionId: 'pi-session-run-lifecycle',
    piSessionFile: '/repo/.pi/session.jsonl',
    messages: [],
    createdAt: 1,
    updatedAt: 2,
  }
}

function runInput(
  payload: HydratedAgentSendPayload,
  signal: AbortSignal = new AbortController().signal,
): AgentKernelRunInput {
  return {
    session: sessionDetail(),
    runId: 'run-lifecycle-test',
    payload,
    model: SupportedModelId('openai/gpt-5.5'),
    signal,
    onEvent: vi.fn(),
  }
}

function assistantMessage(text: string): PiAgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-responses',
    provider: 'openai-codex',
    model: 'openai/gpt-5.5',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

function payload(): HydratedAgentSendPayload {
  return {
    text: 'Continue',
    thinkingLevel: 'high',
    attachments: [],
  }
}

describe('run lifecycle settlement edge cases', () => {
  beforeEach(() => {
    lifecycleMocks.disposeOpenWagglePiSession.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('bounds stalled Pi idle waits with the settlement timeout', async () => {
    vi.useFakeTimers()

    const state: FakeAgentState = { messages: [] }
    const session: FakeSession = {
      sessionId: 'pi-session-run-lifecycle',
      sessionFile: '/repo/.pi/session.jsonl',
      agent: {
        state,
        waitForIdle: vi.fn(() => new Promise<void>(() => undefined)),
        hasQueuedMessages: vi.fn(() => false),
      },
      sessionManager: {
        getEntries: vi.fn(() => []),
        getLeafId: vi.fn(() => null),
      },
      abort: vi.fn(async () => undefined),
      isCompacting: false,
      isStreaming: false,
    }

    const resultPromise = runSubscribedPiOperation({
      runInput: runInput(payload()),
      session: fromPartial<AgentSession>(session),
      unsubscribe: vi.fn(),
      abortWarning: 'abort failed',
      preAbortWarning: 'pre-abort failed',
      operation: async () => {
        state.messages.push(assistantMessage('Finished despite idle wait stall'))
      },
      buildErrorMessages: () => [],
    })

    await vi.advanceTimersByTimeAsync(POST_RUN_SETTLE_MAX_MS)
    const result = await resultPromise

    expect(session.agent.waitForIdle).toHaveBeenCalledOnce()
    expect('terminalError' in result ? result.terminalError : undefined).toBeUndefined()
    expect(result.newMessages).toHaveLength(2)
  })

  it('ignores aborts that arrive after the Pi operation completed', async () => {
    const controller = new AbortController()
    const state: FakeAgentState = { messages: [] }
    let compacting = false
    let abortDuringNextIdleWait = false

    const session: FakeSession = {
      sessionId: 'pi-session-run-lifecycle',
      sessionFile: '/repo/.pi/session.jsonl',
      agent: {
        state,
        waitForIdle: vi.fn(async () => {
          if (abortDuringNextIdleWait) {
            abortDuringNextIdleWait = false
            compacting = false
            controller.abort()
          }
        }),
        hasQueuedMessages: vi.fn(() => false),
      },
      sessionManager: {
        getEntries: vi.fn(() => []),
        getLeafId: vi.fn(() => null),
      },
      abort: vi.fn(async () => undefined),
      get isCompacting() {
        return compacting
      },
      get isStreaming() {
        return false
      },
    }

    const result = await runSubscribedPiOperation({
      runInput: runInput(payload(), controller.signal),
      session: fromPartial<AgentSession>(session),
      unsubscribe: vi.fn(),
      abortWarning: 'abort failed',
      preAbortWarning: 'pre-abort failed',
      operation: async () => {
        state.messages.push(assistantMessage('Finished before late abort'))
        compacting = true
        abortDuringNextIdleWait = true
      },
      buildErrorMessages: () => [],
    })

    expect(controller.signal.aborted).toBe(true)
    expect(session.abort).not.toHaveBeenCalled()
    expect('aborted' in result ? result.aborted : undefined).toBeUndefined()
    expect(result.newMessages).toHaveLength(2)
  })
})
