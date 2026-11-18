import { SessionId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FINISHING_STOP_OFFER_DELAY_MS,
  trackRunFinishing,
  useRunFinishingStore,
} from '../run-finishing-store'

const SESSION_ID = SessionId('session-1')

const agentStart: AgentTransportEvent = { type: 'agent_start', runId: 'run-1', timestamp: 1 }
const agentEnd: AgentTransportEvent = {
  type: 'agent_end',
  runId: 'run-1',
  reason: 'stop',
  timestamp: 2,
}
const agentSettled: AgentTransportEvent = {
  type: 'agent_settled',
  runId: 'run-1',
  aborted: false,
  timestamp: 3,
}

const isFinishing = () => useRunFinishingStore.getState().ids.has(SESSION_ID)
const isStoppable = () => useRunFinishingStore.getState().stoppableIds.has(SESSION_ID)

function wait(ms: number) {
  vi.advanceTimersByTime(ms)
}

describe('run finishing store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useRunFinishingStore.getState().clear(SESSION_ID)
  })

  afterEach(() => {
    useRunFinishingStore.getState().clear(SESSION_ID)
    vi.useRealTimers()
  })

  // Pi runs agent_before_settle handlers after the terminal agent_end; Stop aborts them.
  it('offers Stop while the agent still works on past the delay', () => {
    trackRunFinishing(SESSION_ID, agentStart)
    trackRunFinishing(SESSION_ID, agentEnd)

    expect(isFinishing()).toBe(true)
    wait(FINISHING_STOP_OFFER_DELAY_MS - 1)
    expect(isStoppable()).toBe(false)
    wait(1)
    expect(isStoppable()).toBe(true)

    trackRunFinishing(SESSION_ID, agentSettled)
    expect(isStoppable()).toBe(false)
    expect(isFinishing()).toBe(true)
  })

  it('never offers Stop when Pi settles at once, as it does without slow handlers', () => {
    trackRunFinishing(SESSION_ID, agentEnd)
    trackRunFinishing(SESSION_ID, agentSettled)
    wait(FINISHING_STOP_OFFER_DELAY_MS * 2)

    expect(isFinishing()).toBe(true)
    expect(isStoppable()).toBe(false)
  })

  it('stops offering Stop once it was pressed', () => {
    trackRunFinishing(SESSION_ID, agentEnd)
    wait(FINISHING_STOP_OFFER_DELAY_MS)
    useRunFinishingStore.getState().endStopOffer(SESSION_ID)

    expect(isStoppable()).toBe(false)
    expect(isFinishing()).toBe(true)
  })

  it('forgets a pending Stop offer when another Run starts', () => {
    trackRunFinishing(SESSION_ID, agentEnd)
    trackRunFinishing(SESSION_ID, { ...agentStart, runId: 'run-2' })
    wait(FINISHING_STOP_OFFER_DELAY_MS)

    expect(isFinishing()).toBe(false)
    expect(isStoppable()).toBe(false)
  })
})
