import { describe, expect, it } from 'vitest'
import { decodeHeartbeatRunContext, encodeHeartbeatRunContext } from '../heartbeat-run-context'
import { decideWakeCheck, type WakeCheckExecution } from '../wake-check-decision'

const QUIET: WakeCheckExecution = {
  exitCode: 0,
  signal: null,
  timedOut: false,
  stdout: '',
  stderr: '',
  truncated: false,
}

describe('decideWakeCheck', () => {
  it('is idle only for a clean exit with nothing on standard output', () => {
    expect(decideWakeCheck('c', QUIET, 30_000)).toEqual({ kind: 'idle' })
    expect(decideWakeCheck('c', { ...QUIET, stdout: '  \n' }, 30_000)).toEqual({ kind: 'idle' })
    expect(decideWakeCheck('c', { ...QUIET, stdout: 'x' }, 30_000).kind).toBe('woke')
    expect(decideWakeCheck('c', { ...QUIET, exitCode: 1 }, 30_000).kind).toBe('woke')
  })

  it('reports a check that could not run as failed, with what it printed', () => {
    expect(decideWakeCheck('c', { ...QUIET, startError: 'no shell' }, 30_000)).toMatchObject({
      kind: 'failed',
      message: 'The Wake check could not start: no shell.',
    })
    expect(
      decideWakeCheck('c', { ...QUIET, exitCode: null, signal: 'SIGKILL' }, 30_000),
    ).toMatchObject({
      kind: 'failed',
      report: { result: 'failed', failure: 'was stopped by SIGKILL' },
    })
    expect(
      decideWakeCheck('c', { ...QUIET, exitCode: 126, stderr: 'permission denied' }, 30_000),
    ).toMatchObject({
      kind: 'failed',
      message: 'The Wake check could not run its command (exit 126): permission denied',
    })
  })

  it('bounds the run message', () => {
    const decision = decideWakeCheck('c', { ...QUIET, stdout: 'x'.repeat(2000) }, 30_000)
    expect(decision.kind === 'woke' && decision.message.length).toBe(500)
  })
})

describe('Heartbeat run context', () => {
  it('round-trips and refuses a context the Host did not write', () => {
    const context = {
      runNumber: 2,
      consecutiveIdleRuns: 1,
      idlePauseAfter: 3,
      stopWhen: 'merged',
      indefinite: false,
      endsAt: null,
      maxRuns: null,
      remainingRuns: null,
      modelId: 'test/cheap',
    }
    expect(decodeHeartbeatRunContext(encodeHeartbeatRunContext(context))).toEqual(context)
    expect(() => decodeHeartbeatRunContext('{"runNumber":0}')).toThrow()
  })
})
