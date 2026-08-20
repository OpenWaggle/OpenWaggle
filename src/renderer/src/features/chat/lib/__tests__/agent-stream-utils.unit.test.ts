import { describe, expect, it } from 'vitest'
import { isTerminalTransportEvent } from '../agent-stream-utils'

describe('agent stream utilities', () => {
  it('treats only non-tool-use agent_end events as terminal', () => {
    expect(isTerminalTransportEvent({ type: 'agent_start', runId: 'run-1', timestamp: 0 })).toBe(
      false,
    )
    expect(
      isTerminalTransportEvent({
        type: 'agent_end',
        runId: 'run-1',
        reason: 'toolUse',
        timestamp: 0,
      }),
    ).toBe(false)
    expect(
      isTerminalTransportEvent({ type: 'agent_end', runId: 'run-1', reason: 'stop', timestamp: 0 }),
    ).toBe(true)
    expect(
      isTerminalTransportEvent({
        type: 'agent_end',
        runId: 'run-1',
        reason: 'error',
        timestamp: 0,
      }),
    ).toBe(true)
  })
})
