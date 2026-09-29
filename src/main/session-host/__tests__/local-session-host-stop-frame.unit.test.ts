import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { executeLocalSessionCommandFrame } from '../local-session-command-frame'
import type { LocalSessionServerDependencies } from '../local-session-server'

function drainingDependencies() {
  const liveness = new SessionHostLiveness({ idleGracePeriodMs: 60_000, requestShutdown: vi.fn() })
  const releaseRun = liveness.acquire('run')
  liveness.requestDrain('stop')
  const dispatch = vi.fn<LocalSessionServerDependencies['dispatch']>(async (input) => ({
    stoppingHost: input.requestHostStop(),
  }))
  const dependencies = fromPartial<LocalSessionServerDependencies>({
    hostInstanceId: 'host-1',
    liveness,
    dispatch,
  })
  return { dependencies, dispatch, liveness, releaseRun }
}

function execute(dependencies: LocalSessionServerDependencies, payload: unknown) {
  const send = vi.fn(async () => undefined)
  const run = executeLocalSessionCommandFrame({
    frame: { kind: 'command', requestId: 'request-1', payload },
    caller: fromPartial({ callerId: 'local-user:ada' }),
    negotiatedRevision: 19,
    dependencies,
    eventCursor: { hostInstanceId: 'host-1', sequence: 0 },
    resolveEventCursor: () => fromPartial({}),
    exposeEventCursor: (cursor) => cursor,
    signal: new AbortController().signal,
    send,
  })
  return { run, send }
}

describe('stopping the Session Host while it drains', () => {
  it('still admits a repeated stop request, which reports the stopping Host', async () => {
    const test = drainingDependencies()
    const { run, send } = execute(test.dependencies, {
      contract: 'local-host-v1',
      request: { contractVersion: 1, operation: 'stop' },
    })

    await run
    expect(send).toHaveBeenCalledWith({
      kind: 'response',
      requestId: 'request-1',
      payload: { stoppingHost: { hostInstanceId: 'host-1', runningActions: 0 } },
    })
    expect(test.liveness.drainReason()).toBe('stop')
    test.releaseRun()
  })

  it('still admits an interrupt, and holds the Host open until it has answered', async () => {
    const test = drainingDependencies()
    let operationsDuringDispatch = 0
    test.dispatch.mockImplementation(async () => {
      operationsDuringDispatch = test.liveness.ownerCount('operation')
      return { interrupted: true }
    })

    await execute(test.dependencies, {
      contract: 'session-control-v2',
      request: { command: { operation: 'interrupt' } },
    }).run

    expect(test.dispatch).toHaveBeenCalledTimes(1)
    expect(operationsDuringDispatch).toBe(1)
    expect(test.liveness.ownerCount('operation')).toBe(0)
    test.releaseRun()
  })

  it('refuses other new work with a retryable error for that request only', async () => {
    const test = drainingDependencies()
    const { run, send } = execute(test.dependencies, { contract: 'session-lifecycle-v2' })

    await run
    expect(send).toHaveBeenCalledWith({
      kind: 'error',
      requestId: 'request-1',
      code: 'host_draining',
      message: expect.stringContaining('The Session Host is stopping'),
      retryable: true,
    })
    expect(test.dispatch).not.toHaveBeenCalled()
    test.releaseRun()
  })
})
