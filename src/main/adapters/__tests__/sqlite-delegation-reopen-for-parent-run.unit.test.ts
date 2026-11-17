import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionControlRunIntent } from '../../domain/session-control/message-aggregate'
import { reopenAcceptedDelegationForParentRun } from '../sqlite-delegation-attention'
import {
  makeSessionControlRunLifecycleTestLayer,
  prepareWorkerDelegation,
} from './sqlite-session-control-run-lifecycle-test-layer'

const QUEEN_AGENT = 'session-agent:queen:run-queen'

function intent(fields: Partial<SessionControlRunIntent>) {
  return {
    text: 'Check one more thing.',
    attachmentIds: [],
    callerId: QUEEN_AGENT,
    acceptedAt: 1000,
    idempotencyKey: 'key',
    ...fields,
  } satisfies SessionControlRunIntent
}

/** Which Run starts reopen an accepted Delegation (`sqlite-delegation-attention.ts`). */
describe('reopenAcceptedDelegationForParentRun', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-parent-work-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  function reopen(file: string, runIntent: SessionControlRunIntent, state = 'accepted') {
    const layer = makeSessionControlRunLifecycleTestLayer(path.join(temporaryRoot, file))
    return Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* prepareWorkerDelegation(sql)
        yield* sql`UPDATE delegation_contracts SET state = ${state}`
        const reopened = yield* reopenAcceptedDelegationForParentRun(sql, {
          workerSessionId: 'worker',
          runId: 'run-next',
          intent: runIntent,
          now: 3000,
        })
        const [contract] = yield* sql<{ readonly state: string }>`
          SELECT state FROM delegation_contracts WHERE id = ${'delegation-worker'}
        `
        const transitions = yield* sql<{ readonly actor_session_id: string }>`
          SELECT actor_session_id FROM delegation_state_transitions
        `
        return { reopened, state: contract?.state, transitions }
      }).pipe(Effect.provide(layer)),
    )
  }

  it('reopens it for a Run the parent agent started', async () => {
    const result = await reopen('parent.sqlite', intent({}))
    expect(result.reopened).toEqual({
      delegationId: 'delegation-worker',
      parentSessionId: 'queen',
      workerSessionId: 'worker',
      state: 'working',
    })
    expect(result.state).toBe('working')
    expect(result.transitions).toEqual([{ actor_session_id: 'queen' }])
  })

  it('reopens it for a Follow-up the parent wrote and the person sent as themselves', async () => {
    const result = await reopen(
      'adopted.sqlite',
      intent({ callerId: 'gui:local-user', authorCallerId: QUEEN_AGENT }),
    )
    expect(result.state).toBe('working')
  })

  it.each([
    ['the person', 'person', intent({ callerId: 'gui:local-user' })],
    ['another Session’s agent', 'peer', intent({ callerId: 'session-agent:peer:run-peer' })],
    ['a Hive wake for the Worker’s own Workers', 'wake', intent({ hiveWake: true })],
  ])('leaves it accepted for a Run %s started', async (_label, file, runIntent) => {
    const result = await reopen(`${file}.sqlite`, runIntent)
    expect(result.reopened).toBeUndefined()
    expect(result.state).toBe('accepted')
    expect(result.transitions).toEqual([])
  })

  it.each(['cancelled', 'ready_for_review', 'working'])(
    'changes nothing on a %s Delegation',
    async (state) => {
      const result = await reopen(`${state}.sqlite`, intent({}), state)
      expect(result.reopened).toBeUndefined()
      expect(result.state).toBe(state)
    },
  )
})
