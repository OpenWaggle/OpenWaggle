import { SessionId, SupportedModelId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { broadcastToWindowsMock } = vi.hoisted(() => ({
  broadcastToWindowsMock: vi.fn(),
}))

vi.mock('../../utils/broadcast', () => ({
  broadcastToWindows: broadcastToWindowsMock,
}))

import { resetPhaseForSession } from '../../agent/phase-tracker'
import { clearStreamBuffer, getStreamBuffer, startStreamBuffer } from '../../utils/stream-buffer'
import { relaySessionHostEvent } from '../session-host-renderer-bridge'

const SESSION_ID = SessionId('remote-session')

describe('Session Host renderer bridge settlement', () => {
  beforeEach(() => {
    clearStreamBuffer(SESSION_ID)
    resetPhaseForSession(SESSION_ID)
    broadcastToWindowsMock.mockReset()
  })

  /*
   * A completion names its Run, so the renderer credits it to the send that started that Run, and
   * a Run the Host followed straight on from with a queued Follow-up still reports completion
   * without saying the Session went idle. That used to report nothing until the whole chain ended.
   */
  it('names the settled Run and reports a Run followed by a Follow-up as continuing', () => {
    startStreamBuffer(SESSION_ID, SupportedModelId('openai/gpt-5.5'), 'classic')
    relaySessionHostEvent({
      cursor: { hostInstanceId: 'remote-host', sequence: 1 },
      timestamp: 1,
      payload: {
        kind: 'session-state-changed',
        sessionId: SESSION_ID,
        stateRevision: 3,
        operation: 'follow-up-started',
        runId: 'run-1',
        terminalStatus: 'failed',
      },
    })

    expect(broadcastToWindowsMock).toHaveBeenCalledWith('agent:run-completed', {
      sessionId: SESSION_ID,
      runId: 'run-1',
      terminalStatus: 'failed',
      continues: true,
    })
    // The Session goes on: its stream buffer stays for the next Run.
    expect(getStreamBuffer(SESSION_ID)).not.toBeNull()

    relaySessionHostEvent({
      cursor: { hostInstanceId: 'remote-host', sequence: 2 },
      timestamp: 2,
      payload: {
        kind: 'session-state-changed',
        sessionId: SESSION_ID,
        stateRevision: 5,
        operation: 'run-settled',
        runId: 'run-2',
        terminalStatus: 'failed',
        failureCode: 'persist-failed',
      },
    })

    expect(broadcastToWindowsMock).toHaveBeenCalledWith('agent:run-completed', {
      sessionId: SESSION_ID,
      runId: 'run-2',
      terminalStatus: 'failed',
      failureCode: 'persist-failed',
    })
    expect(getStreamBuffer(SESSION_ID)).toBeNull()
  })
})
