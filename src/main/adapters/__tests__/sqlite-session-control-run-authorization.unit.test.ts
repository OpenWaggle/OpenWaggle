import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  queueSessionFollowUp,
  submitSessionMessage,
} from '../../application/session-control-service'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { makeSessionControlRunLifecycleTestLayer } from './sqlite-session-control-run-lifecycle-test-layer'

describe('SQLite Session queued Run authorization', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-run-authorization-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('keeps a queued YOLO Follow-up visible when its current Session ceiling is lower', async () => {
    const layer = makeSessionControlRunLifecycleTestLayer(
      path.join(temporaryRoot, 'ceiling-change.sqlite'),
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* submitSessionMessage({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-start',
            idempotencyKey: 'idempotency-start',
            command: {
              operation: 'message',
              sessionId: 'session-target',
              input: { text: 'Start working.', attachmentIds: [] },
            },
          },
        })
        yield* queueSessionFollowUp({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-follow-up',
            idempotencyKey: 'idempotency-follow-up',
            command: {
              operation: 'follow-up',
              sessionId: 'session-target',
              runAuthorizationOverride: 'yolo',
              input: { text: 'Continue without approval.', attachmentIds: [] },
            },
          },
        })
        const lifecycle = yield* SessionControlRunLifecycleRepository
        yield* lifecycle.activate({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
        })
        const settlement = yield* lifecycle.settle({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'completed',
        })
        const sql = yield* SqlClient.SqlClient
        const states = yield* sql<{ active_run_id: string | null; queue_state: string }>`
          SELECT active_run_id, queue_state FROM session_control_states
        `
        const followUps = yield* sql<{ delivery_state: string; attention_reason: string | null }>`
          SELECT delivery_state, attention_reason FROM session_follow_ups
        `
        return { settlement, state: states[0], followUp: followUps[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({
      settlement: { accepted: true },
      state: { active_run_id: null, queue_state: 'paused' },
      followUp: {
        delivery_state: 'needs_attention',
        attention_reason: 'authorization_ceiling_changed',
      },
    })
    expect(result.settlement).not.toHaveProperty('scheduled')
  })

  it('runs an omitted-authorization profile Follow-up under the Ask ceiling', async () => {
    const layer = makeSessionControlRunLifecycleTestLayer(
      path.join(temporaryRoot, 'profile-inherited-ask.sqlite'),
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_client_profiles (
            id, name, credential_verifier, capabilities_json, scope_json,
            authorization_ceiling, revoked_at, created_at, updated_at
          ) VALUES (
            ${'profile-ask'}, ${'ask-client'}, ${'verifier'}, ${'["sessions:message"]'},
            ${'{"all":true}'}, ${'ask-for-approval'}, ${null}, ${1000}, ${1000}
          )
        `
        yield* submitSessionMessage({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-start-ask',
            idempotencyKey: 'idempotency-start-ask',
            command: {
              operation: 'message',
              sessionId: 'session-target',
              input: { text: 'Start working.', attachmentIds: [] },
            },
          },
        })
        yield* queueSessionFollowUp({
          callerId: 'profile:profile-ask',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-follow-up-ask',
            idempotencyKey: 'idempotency-follow-up-ask',
            command: {
              operation: 'follow-up',
              sessionId: 'session-target',
              input: { text: 'Continue with approval.', attachmentIds: [] },
            },
          },
        })
        const lifecycle = yield* SessionControlRunLifecycleRepository
        yield* lifecycle.activate({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
        })
        return yield* lifecycle.settle({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'completed',
        })
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({
      accepted: true,
      scheduled: { runId: 'run-after' },
    })
    if (!result.accepted || !result.scheduled) {
      throw new Error('Expected the queued Follow-up to be scheduled.')
    }
    expect(result.scheduled.intent.runAuthorizationOverride).toBeUndefined()
  })

  it('pauses a queued profile Follow-up when its live message capability is removed', async () => {
    const layer = makeSessionControlRunLifecycleTestLayer(
      path.join(temporaryRoot, 'profile-capability-change.sqlite'),
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_client_profiles (
            id, name, credential_verifier, capabilities_json, scope_json,
            authorization_ceiling, revoked_at, created_at, updated_at
          ) VALUES (
            ${'profile-1'}, ${'worker-client'}, ${'verifier'}, ${'["sessions:message"]'},
            ${'{"all":true}'}, ${'yolo'}, ${null}, ${1000}, ${1000}
          )
        `
        yield* submitSessionMessage({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-start',
            idempotencyKey: 'idempotency-start',
            command: {
              operation: 'message',
              sessionId: 'session-target',
              input: { text: 'Start working.', attachmentIds: [] },
            },
          },
        })
        yield* queueSessionFollowUp({
          callerId: 'profile:profile-1',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-profile-follow-up',
            idempotencyKey: 'idempotency-profile-follow-up',
            command: {
              operation: 'follow-up',
              sessionId: 'session-target',
              input: { text: 'Continue after the first run.', attachmentIds: [] },
            },
          },
        })
        yield* sql`
          UPDATE session_client_profiles SET capabilities_json = ${'[]'}, updated_at = ${2000}
          WHERE id = ${'profile-1'}
        `
        const lifecycle = yield* SessionControlRunLifecycleRepository
        yield* lifecycle.activate({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
        })
        const settlement = yield* lifecycle.settle({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'completed',
        })
        const followUps = yield* sql<{
          readonly delivery_state: string
          readonly attention_reason: string | null
        }>`SELECT delivery_state, attention_reason FROM session_follow_ups`
        return { settlement, followUp: followUps[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.settlement).not.toHaveProperty('scheduled')
    expect(result.followUp).toEqual({
      delivery_state: 'needs_attention',
      attention_reason: 'authority_changed',
    })
  })
})
