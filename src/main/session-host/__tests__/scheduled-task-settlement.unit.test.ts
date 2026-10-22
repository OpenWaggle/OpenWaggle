import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { LocalSessionCommandAuthorizationError } from '../../errors'
import { settlementOfDispatch, settlementOfFailure } from '../scheduled-task-settlement'

function controlRejection(code: string) {
  return fromPartial<Parameters<typeof settlementOfDispatch>[0]>({
    contract: 'session-control-v2',
    response: { outcome: { operation: 'start', effect: 'rejected', sessionId: 's', code } },
  })
}

function launchRejection(code: string) {
  return fromPartial<Parameters<typeof settlementOfDispatch>[0]>({
    contract: 'session-lifecycle-v2',
    response: { outcome: { operation: 'launch', effect: 'rejected', code, retryable: false } },
  })
}

describe('Scheduled task run settlement', () => {
  it('records a started Run with its Session', () => {
    expect(
      settlementOfDispatch(
        fromPartial({
          contract: 'session-lifecycle-v2',
          response: {
            outcome: { operation: 'launch', effect: 'launched-root', sessionId: 's', runId: 'r' },
          },
        }),
      ),
    ).toEqual({ run: { status: 'started', sessionId: 's', runId: 'r' } })
  })

  it('skips when the Session or Host is busy, without stopping the task', () => {
    expect(settlementOfDispatch(controlRejection('run_already_active'))).toMatchObject({
      run: { status: 'skipped', reason: 'session-busy' },
    })
    expect(settlementOfDispatch(launchRejection('host_run_ceiling_reached'))).toMatchObject({
      run: { status: 'skipped', reason: 'host-capacity-reached' },
    })
    expect(
      settlementOfDispatch(launchRejection('host_run_ceiling_reached')).attention,
    ).toBeUndefined()
  })

  it('stops the task for problems the user must fix', () => {
    expect(settlementOfDispatch(launchRejection('model_not_found'))).toMatchObject({
      attention: 'model-unavailable',
    })
    expect(settlementOfDispatch(launchRejection('workspace_unavailable'))).toMatchObject({
      attention: 'launch-refused',
    })
    expect(
      settlementOfFailure(
        new LocalSessionCommandAuthorizationError({ code: 'target_scope_denied' }),
      ),
    ).toMatchObject({ attention: 'creator-authority-revoked' })
  })
})
