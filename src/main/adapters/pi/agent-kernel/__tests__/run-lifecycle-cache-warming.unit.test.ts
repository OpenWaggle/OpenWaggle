import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import type { AgentKernelRunInput } from '../../../../ports/agent-kernel-service'
import { idleCacheWarming } from '../pi-idle-cache-warming'
import { runSubscribedPiOperation } from '../run-lifecycle'

const lifecycleMocks = vi.hoisted(() => ({
  disposeOpenWagglePiSession: vi.fn(async () => undefined),
  emitOpenWagglePiSessionShutdown: vi.fn(async () => undefined),
}))

vi.mock('../../pi-session-lifecycle', () => ({
  createOpenWaggleAgentSessionFromServices: vi.fn(),
  disposeOpenWagglePiSession: lifecycleMocks.disposeOpenWagglePiSession,
  emitOpenWagglePiSessionShutdown: lifecycleMocks.emitOpenWagglePiSessionShutdown,
}))

const SESSION_ID = SessionId('run-lifecycle-cache-warming')

function runInput(): AgentKernelRunInput {
  return fromPartial<AgentKernelRunInput>({
    session: { id: SESSION_ID, projectPath: '/repo', messages: [] },
    runId: 'run-lifecycle-cache-warming',
    payload: { text: 'Hello', attachments: [] },
    model: SupportedModelId('openai/gpt-5.5'),
    signal: new AbortController().signal,
    onEvent: vi.fn(),
  })
}

describe('a Run whose prompt cache Pi keeps warm between runs', () => {
  it('keeps the Pi session warming the prompt cache after the Run while Pi is still warming it', async () => {
    const dispose = vi.fn()
    const session = fromPartial<AgentSession>({
      sessionId: 'pi-session-run-lifecycle',
      sessionFile: '/repo/.pi/session.jsonl',
      agent: {
        state: { messages: [] },
        waitForIdle: vi.fn(async () => undefined),
        hasQueuedMessages: vi.fn(() => false),
      },
      sessionManager: {
        getEntries: vi.fn(() => []),
        getBranch: vi.fn(() => []),
        getLeafId: vi.fn(() => null),
      },
      abort: vi.fn(async () => undefined),
      isCompacting: false,
      isStreaming: false,
      cacheWarmingStatus: { state: 'scheduled', nextWarmAt: Date.now() + 60_000 },
      dispose,
    })

    await runSubscribedPiOperation({
      runInput: runInput(),
      session,
      unsubscribe: vi.fn(),
      abortWarning: 'abort failed',
      preAbortWarning: 'pre-abort failed',
      operation: async () => undefined,
      buildErrorMessages: () => [],
    })

    expect(lifecycleMocks.disposeOpenWagglePiSession).not.toHaveBeenCalled()
    expect(lifecycleMocks.emitOpenWagglePiSessionShutdown).toHaveBeenCalledWith(session)
    expect(idleCacheWarming.borrow(SESSION_ID)).toBe(session)

    await idleCacheWarming.release(SESSION_ID)
    expect(dispose).toHaveBeenCalledOnce()
  })
})
