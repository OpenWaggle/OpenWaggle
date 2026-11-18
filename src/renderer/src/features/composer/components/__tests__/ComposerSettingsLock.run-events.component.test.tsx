import type { AgentRunCompletedPayload, IpcEventChannelMap } from '@shared/types/ipc-events'
import type { AgentTransportEvent } from '@shared/types/stream'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundRunMonitor } from '@/features/chat/hooks'
import { useQueuedRunStartStore } from '@/features/chat/state'
import {
  SESSION_SETTINGS_LOCKED_BY_QUEUE_REASON,
  SESSION_SETTINGS_LOCKED_REASON,
} from '../../lib/session-settings-lock'
import {
  expectLocked,
  expectUnlocked,
  MODEL,
  openSession,
  queuedItem,
  renderPickers,
  resetPickers,
  SESSION,
  seedQueue,
} from './composer-settings-lock.test-support'

type AgentEventHandler = (payload: IpcEventChannelMap['agent:event']['payload']) => void
type RunCompletedHandler = (payload: AgentRunCompletedPayload) => void

const handlers = vi.hoisted(() => {
  const state: {
    agentEvent: AgentEventHandler | null
    runCompleted: RunCompletedHandler | null
  } = { agentEvent: null, runCompleted: null }
  return state
})

const api = vi.hoisted(() => ({
  getSettings: vi.fn().mockResolvedValue({}),
  updateSettings: vi.fn().mockResolvedValue({ ok: true }),
  getProviderModels: vi.fn().mockResolvedValue([]),
  setSessionModel: vi.fn().mockResolvedValue(undefined),
  getSessionDetail: vi.fn().mockResolvedValue(null),
  getDefaultThinkingLevel: vi.fn().mockResolvedValue('medium'),
  setDefaultThinkingLevel: vi.fn().mockResolvedValue(undefined),
  setSessionThinkingLevel: vi.fn().mockResolvedValue({ changed: true }),
  querySessionControl: vi.fn().mockRejectedValue(new Error('No Session Host in this test')),
  listActiveRuns: vi.fn().mockResolvedValue([]),
  getBackgroundRun: vi.fn().mockResolvedValue(null),
  onAgentEvent: vi.fn((handler: AgentEventHandler) => {
    handlers.agentEvent = handler
    return vi.fn()
  }),
  onRunCompleted: vi.fn((handler: RunCompletedHandler) => {
    handlers.runCompleted = handler
    return vi.fn()
  }),
}))

vi.mock('@/shared/lib/ipc', () => ({ api }))

function RunMonitor() {
  useBackgroundRunMonitor()
  return null
}

function emit(event: AgentTransportEvent) {
  act(() => handlers.agentEvent?.({ sessionId: SESSION, event }))
}

function complete(payload: Omit<AgentRunCompletedPayload, 'sessionId'>) {
  act(() => handlers.runCompleted?.({ sessionId: SESSION, ...payload }))
}

describe('composer Session settings pickers through real Run events', () => {
  beforeEach(() => {
    resetPickers()
    handlers.agentEvent = null
    handlers.runCompleted = null
  })

  it('stay locked from one Run to the queued Run that follows it, then unlock when it settles', async () => {
    openSession()
    seedQueue({ items: [queuedItem()] })
    renderPickers(<RunMonitor />)

    emit({ type: 'agent_start', runId: 'run-1', model: MODEL, timestamp: 1 })
    expectLocked(SESSION_SETTINGS_LOCKED_BY_QUEUE_REASON)

    // The sequence the Host sends when a Run hands over to the next queued Follow-up.
    emit({ type: 'agent_end', runId: 'run-1', reason: 'stop', model: MODEL, timestamp: 2 })
    expectLocked(SESSION_SETTINGS_LOCKED_BY_QUEUE_REASON)
    complete({ runId: 'run-1', terminalStatus: 'completed', continues: true })
    // The Host delivered the queued message: the queue is empty now.
    act(() => {
      seedQueue({ items: [] })
    })
    await waitFor(() => expectLocked(SESSION_SETTINGS_LOCKED_REASON))
    emit({ type: 'agent_start', runId: 'run-2', model: MODEL, timestamp: 3 })
    expectLocked(SESSION_SETTINGS_LOCKED_REASON)

    emit({ type: 'agent_end', runId: 'run-2', reason: 'stop', model: MODEL, timestamp: 4 })
    expectLocked(SESSION_SETTINGS_LOCKED_REASON)
    complete({ runId: 'run-2', terminalStatus: 'completed' })
    expectUnlocked()
  })

  it('stay locked after a failed retry wait until the Run settles', () => {
    openSession()
    renderPickers(<RunMonitor />)

    emit({ type: 'agent_start', runId: 'run-1', model: MODEL, timestamp: 1 })
    emit({
      type: 'agent_end',
      runId: 'run-1',
      reason: 'error',
      willRetry: true,
      model: MODEL,
      timestamp: 2,
    })
    expectLocked(SESSION_SETTINGS_LOCKED_REASON)
    emit({
      type: 'auto_retry_end',
      success: false,
      attempt: 1,
      finalError: 'stopped',
      model: MODEL,
      timestamp: 3,
    })

    // The Host still settles the Run, and refuses a change until it has.
    expectLocked(SESSION_SETTINGS_LOCKED_REASON)
    complete({ runId: 'run-1', terminalStatus: 'failed' })
    expectUnlocked()
  })

  it('stay locked from a queue action that started a Run until that Run settles', () => {
    openSession()
    useQueuedRunStartStore.getState().mark(SESSION, 'run-resumed')
    renderPickers(<RunMonitor />)

    expectLocked(SESSION_SETTINGS_LOCKED_REASON)
    emit({ type: 'agent_start', runId: 'run-resumed', model: MODEL, timestamp: 1 })
    expectLocked(SESSION_SETTINGS_LOCKED_REASON)
    emit({ type: 'agent_end', runId: 'run-resumed', reason: 'stop', model: MODEL, timestamp: 2 })
    complete({ runId: 'run-resumed', terminalStatus: 'completed' })

    expectUnlocked()
    expect(useQueuedRunStartStore.getState().runIdBySessionId.size).toBe(0)
  })
})
