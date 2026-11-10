import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionControlSessionState } from '../../domain/session-control/message-aggregate'
import {
  planRunSettlement,
  planRunSettlementWithinWorkerLimits,
} from '../sqlite-session-control-run-settlement'
import { loadSessionControlState } from '../sqlite-session-control-state'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'
import { AGENT_CALLER, seedHive } from './sqlite-worker-run-admission.test-support'

const SESSION = 'session-target'
const PERSON = 'gui:local-user'

function intent(id: string, callerId: string, acceptedAt: number) {
  return { text: id, attachmentIds: [], callerId, acceptedAt, idempotencyKey: `key-${id}` }
}

function item(id: string, callerId: string, acceptedAt: number) {
  return {
    id: FollowUpId(id),
    deliveryState: 'pending' as const,
    intent: intent(id, callerId, acceptedAt),
  }
}

/** The person's Run active in their root, its queue as given. */
function personRun(
  base: SessionControlSessionState,
  queue: Partial<SessionControlSessionState['followUpQueue']>,
): SessionControlSessionState {
  return {
    ...base,
    run: { state: 'active', runId: RunId('run-mine') },
    followUpQueue: { ...base.followUpQueue, ...queue },
  }
}

describe('Settlement of the person’s retry past agents’ capacity', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-agent-work-retry-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  // A failed Run's retry waited behind an edit; the person's Run that then completes finds the
  // limit full for the agent's retry, so only the person's own retry starts.
  it('starts the person’s retry when the agent’s deferred retry is refused', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'deferred-retry.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHive(sql, 1)
        yield* sql`
          INSERT INTO settings_store (key, value_json, updated_at)
          VALUES (${'sessionHostRunCeiling'}, ${'1'}, ${1})
        `
        yield* sql`
          INSERT INTO session_execution_profiles (
            session_id, profile_json, authority_origin_caller_id,
            authorization_ceiling, created_at, updated_at
          ) VALUES (
            ${SESSION}, ${'{"modelId":"provider/model","thinkingLevel":"medium"}'},
            ${PERSON}, ${'ask-for-approval'}, ${1}, ${1}
          )
        `
        const base = yield* loadSessionControlState(sql, SESSION)
        const state = personRun(base, {
          state: 'paused',
          pauseReason: 'run-failed',
          deferredRetryAfter: 2,
          items: [
            item('before', PERSON, 1),
            item('agent-retry', AGENT_CALLER, 3),
            item('my-retry', PERSON, 4),
          ],
        })
        return yield* planRunSettlementWithinWorkerLimits(sql, state, {
          sessionId: SessionId(SESSION),
          runId: RunId('run-mine'),
          nextRunId: RunId('run-next'),
          terminalStatus: 'completed',
        })
      }).pipe(Effect.provide(layer)),
    )

    if (!result.accepted) throw new Error('settlement refused')
    expect(result.scheduled?.followUpId).toBe('my-retry')
    expect(result.state.followUpQueue).toMatchObject({
      state: 'paused',
      pauseReason: 'run-failed',
      items: [{ id: 'before' }, { id: 'agent-retry' }],
    })
  })

  // Clients that name the queue revision see the reason change.
  it('bumps the queue revision when a stop replaces a wait on capacity', () => {
    const before = personRun(
      {
        sessionId: SessionId(SESSION),
        revision: 1,
        run: { state: 'idle' },
        followUpQueue: { state: 'running', revision: 4, items: [] },
      },
      { state: 'paused', pauseReason: 'parent-limit', items: [item('agents', AGENT_CALLER, 1)] },
    )

    const settled = planRunSettlement(before, {
      sessionId: SessionId(SESSION),
      runId: RunId('run-mine'),
      nextRunId: RunId('run-next'),
      terminalStatus: 'interrupted',
      terminalEventAt: 5,
    })

    if (!settled.accepted) throw new Error('settlement refused')
    expect(settled.state.followUpQueue).toMatchObject({
      pauseReason: 'run-interrupted',
      revision: 5,
    })
  })
})
