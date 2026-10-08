import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { broadcastToWindowsMock } = vi.hoisted(() => ({
  broadcastToWindowsMock: vi.fn(),
}))

vi.mock('../../utils/broadcast', () => ({
  broadcastToWindows: broadcastToWindowsMock,
}))

import { resetPhaseForSession } from '../../agent/phase-tracker'
import { clearStreamBuffer } from '../../utils/stream-buffer'
import { reconcileRemoteRunSnapshots, relaySessionHostEvent } from '../session-host-renderer-bridge'

const SESSION_ID = SessionId('remote-session')
const MODEL = SupportedModelId('openai/gpt-5.5')

function snapshot(runId?: string): BackgroundRunSnapshot {
  return {
    activity: 'agent-run',
    sessionId: SESSION_ID,
    ...(runId ? { runId } : {}),
    model: MODEL,
    mode: 'classic',
    startedAt: 20,
    activityEvents: [],
    parts: [],
  }
}

function relayStart(runId: string, sequence = 1) {
  relaySessionHostEvent({
    cursor: { hostInstanceId: 'remote-host', sequence },
    timestamp: sequence,
    payload: {
      kind: 'session-transport',
      sessionId: SESSION_ID,
      event: { type: 'agent_start', runId, model: String(MODEL), timestamp: sequence },
    },
  })
}

function relayHandOff(runId: string) {
  relaySessionHostEvent({
    cursor: { hostInstanceId: 'remote-host', sequence: 2 },
    timestamp: 2,
    payload: {
      kind: 'session-state-changed',
      sessionId: SESSION_ID,
      stateRevision: 3,
      operation: 'follow-up-started',
      runId,
      terminalStatus: 'completed',
    },
  })
}

type Lifecycle = { readonly completed: unknown } | { readonly started: unknown }

/** The run-completed and agent_start broadcasts, in order, as the renderer receives them. */
function lifecycle() {
  return broadcastToWindowsMock.mock.calls.flatMap(([channel, payload]): Lifecycle[] => {
    if (channel === 'agent:run-completed') return [{ completed: payload }]
    if (channel === 'agent:event' && payload.event.type === 'agent_start') {
      return [{ started: payload.event.runId }]
    }
    return []
  })
}

/*
 * A resync (the Host restarted, the subscription's cursor expired, a slow consumer) loses the
 * events of a disconnect. The bridge compares the Run it last relayed for each Session with the
 * Host's snapshot and relays the settlement the renderer missed, naming that Run, before it
 * announces the Run the Host went on to.
 */
describe('Session Host renderer bridge missed settlements', () => {
  beforeEach(() => {
    reconcileRemoteRunSnapshots([])
    clearStreamBuffer(SESSION_ID)
    resetPhaseForSession(SESSION_ID)
    broadcastToWindowsMock.mockReset()
  })

  it('relays the settlement of a Run that settled while the Host went on to the next', () => {
    relayStart('run-1')
    broadcastToWindowsMock.mockClear()

    reconcileRemoteRunSnapshots([snapshot('run-2')])

    expect(lifecycle()).toEqual([
      { completed: { sessionId: SESSION_ID, runId: 'run-1', continues: true } },
      { started: 'run-2' },
    ])
  })

  it('names the Run that settled when the Session went idle meanwhile', () => {
    relayStart('run-1')
    broadcastToWindowsMock.mockClear()

    reconcileRemoteRunSnapshots([])

    expect(lifecycle()).toEqual([{ completed: { sessionId: SESSION_ID, runId: 'run-1' } }])
  })

  it('relays nothing for a Run still running, and nothing twice', () => {
    relayStart('run-1')
    broadcastToWindowsMock.mockClear()

    reconcileRemoteRunSnapshots([snapshot('run-1')])
    expect(lifecycle()).toEqual([])

    reconcileRemoteRunSnapshots([snapshot('run-2')])
    reconcileRemoteRunSnapshots([snapshot('run-2')])
    expect(lifecycle()).toEqual([
      { completed: { sessionId: SESSION_ID, runId: 'run-1', continues: true } },
      { started: 'run-2' },
    ])
  })

  it('does not repeat a hand-off it relayed before the next Run started', () => {
    relayStart('run-1')
    relayHandOff('run-1')
    broadcastToWindowsMock.mockClear()

    reconcileRemoteRunSnapshots([snapshot('run-2')])

    expect(lifecycle()).toEqual([{ started: 'run-2' }])
  })

  it('settles the Session without naming a Run it already relayed as handed off', () => {
    relayStart('run-1')
    relayHandOff('run-1')
    broadcastToWindowsMock.mockClear()

    reconcileRemoteRunSnapshots([])

    expect(lifecycle()).toEqual([{ completed: { sessionId: SESSION_ID } }])
  })

  it('announces a Run it never relayed by its id, or unnamed from an older Host', () => {
    reconcileRemoteRunSnapshots([snapshot('run-7')])
    expect(lifecycle()).toEqual([{ started: 'run-7' }])

    reconcileRemoteRunSnapshots([])
    broadcastToWindowsMock.mockClear()
    reconcileRemoteRunSnapshots([snapshot()])
    // Nothing tells another Run from the one an older Host's snapshot holds: no settlement.
    reconcileRemoteRunSnapshots([snapshot()])
    expect(lifecycle()).toEqual([{ started: `remote-snapshot:${SESSION_ID}` }])
  })

  /*
   * A requested Waggle streams as `waggle-of-<X>` and settles as X: the bridge names every
   * settlement it makes up by the classic Run, and takes the Waggle for the same Run.
   */
  it('names a missed settlement by the classic Run behind a requested Waggle', () => {
    relayStart('run-X')
    relayStart('waggle-of-run-X', 2)
    broadcastToWindowsMock.mockClear()

    reconcileRemoteRunSnapshots([])

    expect(lifecycle()).toEqual([{ completed: { sessionId: SESSION_ID, runId: 'run-X' } }])
  })

  it('takes a requested Waggle the resync finds for the Run it relayed', () => {
    relayStart('run-X')
    broadcastToWindowsMock.mockClear()

    reconcileRemoteRunSnapshots([snapshot('waggle-of-run-X')])

    expect(lifecycle()).toEqual([])
  })

  it('does not repeat a hand-off relayed while the buffer held the requested Waggle', () => {
    relayStart('run-X')
    relayStart('waggle-of-run-X', 2)
    relayHandOff('run-X')
    broadcastToWindowsMock.mockClear()

    reconcileRemoteRunSnapshots([snapshot('run-Y')])

    expect(lifecycle()).toEqual([{ started: 'run-Y' }])
  })

  /*
   * The Host keeps the settled Run's buffer until the next Run's starts: a resync in between finds
   * that Run still in the snapshot, and the hand-off it lost shows only as the next Run's start.
   */
  it('relays a hand-off the resync missed when the next Run starts', () => {
    relayStart('run-X')
    reconcileRemoteRunSnapshots([snapshot('run-X')])
    broadcastToWindowsMock.mockClear()

    relayStart('run-Y', 3)
    relayStart('run-Y', 4)

    expect(lifecycle()).toEqual([
      { completed: { sessionId: SESSION_ID, runId: 'run-X', continues: true } },
      { started: 'run-Y' },
      { started: 'run-Y' },
    ])
  })

  it('relays nothing more when the next Run starts after a hand-off it relayed', () => {
    relayStart('run-X')
    relayHandOff('run-X')
    broadcastToWindowsMock.mockClear()

    relayStart('run-Y', 3)

    expect(lifecycle()).toEqual([{ started: 'run-Y' }])
  })
})
