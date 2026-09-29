import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ publish: vi.fn() }))

vi.mock('../../session-host/session-host-events', () => ({
  publishSessionHostEvent: mocks.publish,
}))

const { publishRunStartFailure } = await import('../session-control-run-result')

describe('Runs that fail before reaching Pi', () => {
  it('end with an agent_end that carries the reason and code', () => {
    publishRunStartFailure(
      fromPartial({ sessionId: 's-1', runId: 'r-1' }),
      Object.assign(new Error('Project settings are invalid JSON.'), { code: 'invalid_config' }),
    )

    expect(mocks.publish).toHaveBeenCalledWith({
      kind: 'session-transport',
      sessionId: 's-1',
      event: {
        type: 'agent_end',
        runId: 'r-1',
        reason: 'error',
        error: { message: 'Project settings are invalid JSON.', code: 'invalid_config' },
        timestamp: expect.any(Number),
      },
    })
  })

  it('describes errors that are not Error objects', () => {
    mocks.publish.mockClear()
    publishRunStartFailure(fromPartial({ sessionId: 's-1', runId: 'r-1' }), 'no model')

    expect(mocks.publish.mock.calls[0]?.[0].event.error).toEqual({ message: 'no model' })
  })
})
