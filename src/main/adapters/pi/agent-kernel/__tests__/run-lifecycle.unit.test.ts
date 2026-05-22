import type { AgentSession } from '@mariozechner/pi-coding-agent'
import { getMessageText, type HydratedAgentSendPayload } from '@shared/types/agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentKernelRunInput } from '../../../../ports/agent-kernel-service'
import { runSubscribedPiOperation } from '../run-lifecycle'

const lifecycleMocks = vi.hoisted(() => ({
  disposeOpenWagglePiSession: vi.fn(async () => undefined),
}))

vi.mock('../../pi-session-lifecycle', () => ({
  createOpenWaggleAgentSessionFromServices: vi.fn(),
  disposeOpenWagglePiSession: lifecycleMocks.disposeOpenWagglePiSession,
}))

interface FakeAgentState {
  messages: PiAgentMessage[]
}

type PiAgentMessage = AgentSession['agent']['state']['messages'][number]

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

function runInput(payload: HydratedAgentSendPayload): AgentKernelRunInput {
  return {
    session: sessionDetail(),
    runId: 'run-lifecycle-test',
    payload,
    model: SupportedModelId('openai/gpt-5.5'),
    signal: new AbortController().signal,
    onEvent: vi.fn(),
  }
}

function assistantMessage(input: {
  readonly text: string
  readonly stopReason: 'stop' | 'error'
  readonly errorMessage?: string
}): PiAgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: input.text }],
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
    stopReason: input.stopReason,
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    timestamp: Date.now(),
  }
}

describe('run lifecycle settlement', () => {
  beforeEach(() => {
    lifecycleMocks.disposeOpenWagglePiSession.mockClear()
  })

  it('waits for delayed post-run recovery updates before snapshot capture', async () => {
    const messages: PiAgentMessage[] = []
    let compacting = false
    const state: FakeAgentState = { messages }

    const session: FakeSession = {
      sessionId: 'pi-session-run-lifecycle',
      sessionFile: '/repo/.pi/session.jsonl',
      agent: {
        state,
        waitForIdle: vi.fn(async () => undefined),
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

    const overflowError = assistantMessage({
      text: '',
      stopReason: 'error',
      errorMessage: 'context overflow',
    })
    const recoveredAssistant = assistantMessage({
      text: 'Recovered after compact',
      stopReason: 'stop',
    })

    const payload: HydratedAgentSendPayload = {
      text: 'Analyze and continue',
      thinkingLevel: 'high',
      attachments: [],
    }

    const result = await runSubscribedPiOperation({
      runInput: runInput(payload),
      session: fromPartial<AgentSession>(session),
      unsubscribe: vi.fn(),
      abortWarning: 'abort failed',
      preAbortWarning: 'pre-abort failed',
      operation: async () => {
        messages.push(overflowError)
        compacting = true

        setTimeout(() => {
          messages.pop()
          messages.push(recoveredAssistant)
          compacting = false
        }, 40)
      },
      buildErrorMessages: () => [],
    })

    expect('terminalError' in result ? result.terminalError : undefined).toBeUndefined()
    expect(result.newMessages).toHaveLength(2)
    const recoveredMessage = result.newMessages[1]
    expect(recoveredMessage?.role).toBe('assistant')
    expect(recoveredMessage ? getMessageText(recoveredMessage) : null).toBe(
      'Recovered after compact',
    )
    expect(lifecycleMocks.disposeOpenWagglePiSession).toHaveBeenCalledWith(session)
  })

  it('calls Pi agent settlement methods with their original receiver', async () => {
    const state: FakeAgentState = { messages: [] }
    const agent = {
      state,
      idleWaits: 0,
      steeringQueue: { hasItems: () => false },
      followUpQueue: { hasItems: () => false },
      async waitForIdle() {
        this.idleWaits += 1
      },
      hasQueuedMessages() {
        return this.steeringQueue.hasItems() || this.followUpQueue.hasItems()
      },
    }
    const session: FakeSession = {
      sessionId: 'pi-session-run-lifecycle',
      sessionFile: '/repo/.pi/session.jsonl',
      agent,
      sessionManager: {
        getEntries: vi.fn(() => []),
        getLeafId: vi.fn(() => null),
      },
      abort: vi.fn(async () => undefined),
      isCompacting: false,
      isStreaming: false,
    }

    const payload: HydratedAgentSendPayload = {
      text: 'Continue',
      thinkingLevel: 'high',
      attachments: [],
    }

    const result = await runSubscribedPiOperation({
      runInput: runInput(payload),
      session: fromPartial<AgentSession>(session),
      unsubscribe: vi.fn(),
      abortWarning: 'abort failed',
      preAbortWarning: 'pre-abort failed',
      operation: async () => {
        state.messages.push(
          assistantMessage({
            text: 'Finished',
            stopReason: 'stop',
          }),
        )
      },
      buildErrorMessages: () => [],
    })

    expect('terminalError' in result ? result.terminalError : undefined).toBeUndefined()
    expect(result.newMessages).toHaveLength(2)
    expect(agent.idleWaits).toBeGreaterThan(0)
  })
})
