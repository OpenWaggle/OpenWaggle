// @vitest-environment jsdom

import { SessionId, SupportedModelId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MessageDeliveredRunFailed } from '../../lib/message-delivery'
import { useRunFinishingStore } from '../../state/run-finishing-store'
import {
  apiMock,
  createDeferred,
  createSession,
  emitAgentEvent,
  emitRunCompleted,
  installUseAgentChatTestLifecycle,
  SEND_PAYLOAD,
  useAgentChat,
} from './useAgentChat.test-utils'

const SESSION_ID = SessionId('session-1')
const MODEL = SupportedModelId('openrouter/anthropic/claude-haiku-4.5')
const BILLING_ERROR = 'This request requires more credits'

function renderChat() {
  return renderHook(() => useAgentChat(SESSION_ID, createSession(), MODEL, 'medium'))
}

function trackOutcome(send: Promise<void>) {
  const outcome: { value: unknown } = { value: 'pending' }
  void send.then(
    () => {
      outcome.value = 'resolved'
    },
    (error: unknown) => {
      outcome.value = error
    },
  )
  return outcome
}

function failRun(runId: string) {
  emitAgentEvent({
    sessionId: SESSION_ID,
    event: { type: 'agent_start', runId, model: MODEL, timestamp: 1 },
  })
  emitAgentEvent({
    sessionId: SESSION_ID,
    event: {
      type: 'agent_end',
      runId,
      reason: 'error',
      error: { message: BILLING_ERROR, code: 'insufficient-credits' },
      timestamp: 2,
    },
  })
}

describe('useAgentChat run completions bound to their Run', () => {
  installUseAgentChatTestLifecycle()
  afterEach(() => {
    useRunFinishingStore.setState({ ids: new Set() })
  })

  /*
   * A completion names the Run that settled. It used to settle whichever send was pending, so the
   * earlier Run settling just after a new send began resolved the new send while its Run was still
   * running, and the earlier send was never told anything.
   */
  it('credits an earlier Run completion to its own send, not to the one just sent', async () => {
    const { result } = renderChat()
    apiMock.sendMessage.mockResolvedValueOnce({ outcome: 'delivered', runId: 'run-1' })

    let first: { value: unknown } = { value: 'unset' }
    await act(async () => {
      first = trackOutcome(result.current.sendMessage(SEND_PAYLOAD))
    })
    await act(async () => {
      failRun('run-1')
    })

    const secondReport = createDeferred<{ readonly outcome: 'delivered'; readonly runId: string }>()
    apiMock.sendMessage.mockReturnValueOnce(secondReport.promise)
    let second: { value: unknown } = { value: 'unset' }
    await act(async () => {
      second = trackOutcome(result.current.sendMessage({ ...SEND_PAYLOAD, text: 'Try again' }))
    })
    // run-1 settles after the retry was sent but before the Host said which Run it started.
    await act(async () => {
      emitRunCompleted({ sessionId: SESSION_ID, runId: 'run-1', terminalStatus: 'failed' })
    })
    await act(async () => {
      secondReport.resolve({ outcome: 'delivered', runId: 'run-2' })
    })

    expect(first.value).toBeInstanceOf(MessageDeliveredRunFailed)
    expect(second.value).toBe('pending')

    await act(async () => {
      emitAgentEvent({
        sessionId: SESSION_ID,
        event: { type: 'agent_start', runId: 'run-2', model: MODEL, timestamp: 3 },
      })
    })
    expect(result.current.isLoading).toBe(true)

    await act(async () => {
      emitAgentEvent({
        sessionId: SESSION_ID,
        event: { type: 'agent_end', runId: 'run-2', reason: 'stop', timestamp: 4 },
      })
      emitRunCompleted({ sessionId: SESSION_ID, runId: 'run-2', terminalStatus: 'completed' })
    })

    expect(second.value).toBe('resolved')
    expect(result.current.status).toBe('ready')
  })

  it('settles a send whose Run went straight on to a queued Follow-up', async () => {
    const { result } = renderChat()
    apiMock.sendMessage.mockResolvedValueOnce({ outcome: 'delivered', runId: 'run-1' })

    let first: { value: unknown } = { value: 'unset' }
    await act(async () => {
      first = trackOutcome(result.current.sendMessage(SEND_PAYLOAD))
    })
    await act(async () => {
      emitAgentEvent({
        sessionId: SESSION_ID,
        event: { type: 'agent_start', runId: 'run-1', model: MODEL, timestamp: 1 },
      })
      emitAgentEvent({
        sessionId: SESSION_ID,
        event: { type: 'agent_end', runId: 'run-1', reason: 'stop', timestamp: 2 },
      })
      emitRunCompleted({
        sessionId: SESSION_ID,
        runId: 'run-1',
        terminalStatus: 'completed',
        continues: true,
      })
    })

    expect(first.value).toBe('resolved')
    // The Follow-up's Run is starting; the Session has not gone idle.
    expect(result.current.isLoading).toBe(true)
  })

  it('shows a failure the Host found after the Run reported a clean end', async () => {
    const { result } = renderChat()
    apiMock.sendMessage.mockResolvedValueOnce({ outcome: 'delivered', runId: 'run-1' })

    let first: { value: unknown } = { value: 'unset' }
    await act(async () => {
      first = trackOutcome(result.current.sendMessage(SEND_PAYLOAD))
    })
    await act(async () => {
      emitAgentEvent({
        sessionId: SESSION_ID,
        event: { type: 'agent_start', runId: 'run-1', model: MODEL, timestamp: 1 },
      })
      emitAgentEvent({
        sessionId: SESSION_ID,
        event: { type: 'agent_end', runId: 'run-1', reason: 'stop', timestamp: 2 },
      })
      emitRunCompleted({
        sessionId: SESSION_ID,
        runId: 'run-1',
        terminalStatus: 'failed',
        failureCode: 'persist-failed',
      })
    })

    expect(first.value).toBeInstanceOf(MessageDeliveredRunFailed)
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBeInstanceOf(Error)
  })

  // The agent is done and the Host is still settling the Run: not idle, and not running either.
  it('reports a finishing Session while the Host settles its Run', async () => {
    const { result } = renderChat()

    await act(async () => {
      failRun('run-1')
      useRunFinishingStore.getState().mark(SESSION_ID)
    })

    expect(result.current.status).toBe('finishing')
    expect(result.current.isLoading).toBe(true)
    expect(result.current.error?.message).toBe(BILLING_ERROR)

    await act(async () => {
      useRunFinishingStore.getState().clear(SESSION_ID)
      emitRunCompleted({ sessionId: SESSION_ID, runId: 'run-1', terminalStatus: 'failed' })
    })

    expect(result.current.status).toBe('error')
    expect(result.current.isLoading).toBe(false)
  })
})
