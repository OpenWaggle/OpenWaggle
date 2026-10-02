import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resetForegroundSendsForTests,
  useForegroundSendStore,
} from '@/features/chat/state/foreground-send-store'
import { useQueuedRunStartStore } from '@/features/chat/state/queued-run-start-store'
import {
  resetThinkingLevelWritesForTests,
  writeThinkingLevel,
} from '@/features/chat/state/session-thinking-level-writes'
import { renderHookWithQueryClient } from '@/test-utils/query-test-utils'
import { SessionControlRejectedError } from '../session-follow-up-queue-model'
import { useSessionFollowUpQueue } from '../useSessionFollowUpQueue'
import { queueResponse, SESSION_ID } from './session-follow-up-queue.test-fixtures'

const apiMocks = vi.hoisted(() => ({
  querySessionControl: vi.fn(),
  mutateSessionControl: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

type Outcome = Record<string, unknown>

/** An idle Session whose queue paused (revision 4). */
function pausedQueue() {
  const response = queueResponse()
  return {
    ...response,
    outcome: {
      ...response.outcome,
      queueState: 'paused' as const,
      queuePauseReason: 'profile-revoked' as const,
      activeRunId: null,
    },
  }
}

function answer(outcome: (operation: string) => Outcome) {
  apiMocks.mutateSessionControl.mockImplementation(async (request) => ({
    contractVersion: 2,
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    replayed: false,
    outcome: {
      operation: request.command.operation,
      sessionId: SESSION_ID,
      ...outcome(request.command.operation),
    },
  }))
}

const STARTED_RUN = {
  effect: 'started-run',
  runId: 'run-started',
  followUpId: 'follow-up-1',
  queueRevision: 5,
  stateRevision: 6,
}

const QUEUE_UPDATED = {
  effect: 'queue-updated',
  queueState: 'paused',
  queueRevision: 5,
  followUpIds: ['follow-up-1'],
  stateRevision: 6,
}

function commands() {
  return apiMocks.mutateSessionControl.mock.calls.map(([request]) => request.command)
}

function isStarting() {
  return useForegroundSendStore.getState().counts.has(SESSION_ID)
}

async function renderQueue() {
  const view = renderHookWithQueryClient(() => useSessionFollowUpQueue(SESSION_ID))
  await waitFor(() => expect(view.result.current.snapshot.revision).toBe(4))
  apiMocks.querySessionControl.mockClear()
  return view
}

describe('useSessionFollowUpQueue queue state', () => {
  beforeEach(() => {
    resetThinkingLevelWritesForTests()
    resetForegroundSendsForTests()
    useQueuedRunStartStore.setState(useQueuedRunStartStore.getInitialState())
    apiMocks.querySessionControl.mockReset().mockResolvedValue(pausedQueue())
    apiMocks.mutateSessionControl.mockReset()
  })

  it('pauses under the loaded revision and re-reads the queue', async () => {
    answer(() => QUEUE_UPDATED)
    const { result } = await renderQueue()

    await act(() => result.current.setPaused(true))

    expect(commands()).toEqual([
      { operation: 'queue-pause', sessionId: SESSION_ID, expectedQueueRevision: 4 },
    ])
    expect(apiMocks.querySessionControl).toHaveBeenCalledTimes(1)
    // Pausing never starts a Run, so nothing marks the Session as starting one.
    expect(useQueuedRunStartStore.getState().runIdBySessionId.size).toBe(0)
  })

  it('rejects a pause with a stale revision but still re-reads the queue', async () => {
    answer(() => ({ effect: 'rejected', code: 'queue_revision_changed' }))
    const { result } = await renderQueue()

    await act(async () => {
      await expect(result.current.setPaused(true, 3)).rejects.toEqual(
        new SessionControlRejectedError('queue-pause', 'queue_revision_changed'),
      )
    })

    expect(commands()).toEqual([
      { operation: 'queue-pause', sessionId: SESSION_ID, expectedQueueRevision: 3 },
    ])
    expect(apiMocks.querySessionControl).toHaveBeenCalledTimes(1)
  })

  it('resumes only after a thinking pick made just before has landed, locked the whole way', async () => {
    answer(() => STARTED_RUN)
    const { result } = await renderQueue()
    let finishWrite: (() => void) | undefined
    void writeThinkingLevel({
      target: SESSION_ID,
      level: 'high',
      write: () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve
        }),
      refresh: async () => {},
    })

    let resumed: Promise<void> | undefined
    act(() => {
      resumed = result.current.setPaused(false)
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    // The Host would start the next Run with the old level; it waits, and the pickers stay locked.
    expect(apiMocks.mutateSessionControl).not.toHaveBeenCalled()
    expect(isStarting()).toBe(true)

    await act(async () => {
      finishWrite?.()
      await resumed
    })

    expect(commands()).toEqual([
      { operation: 'queue-resume', sessionId: SESSION_ID, expectedQueueRevision: 4 },
    ])
    // The Run started: the Session is still starting it until it reports `agent_start`.
    expect(useQueuedRunStartStore.getState().runIdBySessionId.get(SESSION_ID)).toBe('run-started')
    expect(isStarting()).toBe(false)
  })

  it('adopts from a paused queue and marks the Run the Host started for it', async () => {
    answer(() => STARTED_RUN)
    const { result } = await renderQueue()

    await act(() => result.current.adopt('follow-up-1'))

    expect(commands()).toEqual([
      {
        operation: 'queue-adopt',
        sessionId: SESSION_ID,
        followUpId: 'follow-up-1',
        expectedQueueRevision: 4,
      },
    ])
    expect(useQueuedRunStartStore.getState().runIdBySessionId.get(SESSION_ID)).toBe('run-started')
    expect(apiMocks.querySessionControl).toHaveBeenCalledTimes(1)
  })

  it('does not mark a Run when an adoption only queues the message', async () => {
    answer(() => QUEUE_UPDATED)
    const { result } = await renderQueue()

    await act(() => result.current.adopt('follow-up-1', 4))

    expect(useQueuedRunStartStore.getState().runIdBySessionId.size).toBe(0)
    expect(isStarting()).toBe(false)
  })

  it('re-reads the queue after a refused adoption', async () => {
    answer(() => ({ effect: 'rejected', code: 'queue_revision_changed' }))
    const { result } = await renderQueue()

    await act(async () => {
      await expect(result.current.adopt('follow-up-1')).rejects.toBeInstanceOf(
        SessionControlRejectedError,
      )
    })

    expect(apiMocks.querySessionControl).toHaveBeenCalledTimes(1)
    expect(isStarting()).toBe(false)
  })

  it('never marks a Run that already reported in before the Host answered', async () => {
    answer(() => STARTED_RUN)
    const { result } = await renderQueue()
    // The Run's `agent_start` reached this window first.
    useQueuedRunStartStore.getState().settle(SESSION_ID, 'run-started')

    await act(() => result.current.setPaused(false))

    expect(useQueuedRunStartStore.getState().runIdBySessionId.size).toBe(0)
  })
})
