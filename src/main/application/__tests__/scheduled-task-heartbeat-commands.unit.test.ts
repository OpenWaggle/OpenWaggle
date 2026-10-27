import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  ScheduledTaskRepository,
  type ScheduledTaskRepositoryShape,
} from '../../ports/scheduled-task-repository'
import { approveWakeCheck, reportHeartbeatOutcome } from '../scheduled-task-heartbeat-commands'
import type { ScheduledTaskPrincipal } from '../scheduled-task-principal'

function principal(callerId: string, localUser = false) {
  return fromPartial<ScheduledTaskPrincipal>({ caller: { callerId }, localUser, ownerKey: 'owner' })
}

describe('Heartbeat commands (#388)', () => {
  it('refuses a CLI client profile approving a Wake check: only the user may', async () => {
    const get = vi.fn()
    const outcome = await Effect.runPromise(
      approveWakeCheck(principal('profile:helper'), {
        operation: 'approve-wake-check',
        taskId: 'task-1',
        command: 'true',
      }).pipe(Effect.provideService(ScheduledTaskRepository, fromPartial({ get }))),
    )
    expect(outcome).toMatchObject({ effect: 'rejected', code: 'capability_denied' })
    expect(get).not.toHaveBeenCalled()
  })

  it('lets only the Heartbeat Run own Session report its outcome', async () => {
    const recordRunOutcome = vi.fn()
    const repository = fromPartial<ScheduledTaskRepositoryShape>({
      runOfSessionRun: () =>
        Effect.succeed({ id: 'run', taskId: 'task', sessionId: 'session-a', outcome: null }),
      get: () => Effect.succeed({ id: 'task', kind: 'heartbeat', ownerKey: 'owner' }),
      recordRunOutcome,
    })
    const outcome = await Effect.runPromise(
      reportHeartbeatOutcome(principal('session-agent:session-b:run'), {
        operation: 'report-outcome',
        runId: 'run-a',
        outcome: 'done',
      }).pipe(Effect.provideService(ScheduledTaskRepository, repository)),
    )
    expect(outcome).toMatchObject({ effect: 'rejected', code: 'run_not_scheduled' })
    expect(recordRunOutcome).not.toHaveBeenCalled()
  })
})
