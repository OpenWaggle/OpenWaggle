import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { FollowUpId, ReportCorrelationId, ReportId, RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import type { SessionHostEventPayload } from '@shared/types/session-host-event'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  makeHiveWorkerCleanupTestLayer,
  QUEEN_CALLER_ID,
  seedHiveWorker,
} from '../../adapters/__tests__/hive-worker-cleanup-fixture'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { SessionOrchestrationUpdateDeliveryService } from '../../ports/session-orchestration-update-delivery-service'
import { installSessionHostEventPublisher } from '../../session-host/session-host-events'
import { makeHiveWorkerCleanupLayer } from '../hive-worker-cleanup-service'
import { startSessionRun } from '../session-control-service'
import { executeSessionDelegationMutation } from '../session-delegation-service'
import { settleExternalSessionRun } from '../session-external-run-coordinator'
import { organizeSession } from '../session-organization-service'

function hiveHostLayer(databasePath: string) {
  const store = makeHiveWorkerCleanupTestLayer(databasePath)
  let runSequence = 0
  const supportLayer = Layer.mergeAll(
    Layer.succeed(SessionControlIdentityService, {
      nextRunId: Effect.sync(() => {
        runSequence += 1
        return RunId(`run-generated-${String(runSequence)}`)
      }),
      nextFollowUpId: Effect.succeed(FollowUpId('follow-up-unused')),
      nextReportId: Effect.succeed(ReportId('report-unused')),
      nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
      now: Effect.succeed(5000),
    }),
    Layer.succeed(SessionOrchestrationUpdateDeliveryService, {
      deliverPendingToActiveRun: () => Effect.succeed(false),
      deliverPendingSpecificationsToActiveRun: () => Effect.succeed(false),
    }),
  )
  const cleanup = makeHiveWorkerCleanupLayer('inline').pipe(Layer.provide(store))
  return Layer.mergeAll(store, supportLayer, cleanup)
}

function seedQueenAuthority(sql: SqlClient.SqlClient, projectPath: string) {
  return Effect.gen(function* () {
    yield* sql.unsafe(`CREATE TABLE settings_store (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
    yield* sql`UPDATE sessions SET project_path = ${projectPath}`
    yield* sql`
      INSERT INTO session_execution_profiles (
        session_id, profile_json, authority_origin_caller_id,
        authorization_ceiling, created_at, updated_at
      ) VALUES (
        ${'queen'}, ${'{"modelId":"provider/model","thinkingLevel":"medium"}'},
        ${'gui:local-user'}, ${'ask-for-approval'}, ${1000}, ${1000}
      )
    `
  })
}

function archived(sql: SqlClient.SqlClient, sessionId: string) {
  return sql<{ readonly archived: number }>`
    SELECT archived FROM sessions WHERE id = ${sessionId}
  `.pipe(Effect.map((rows) => rows[0]?.archived === 1))
}

function startAs(callerId: string, sessionId: string, key: string) {
  return startSessionRun({
    callerId,
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: key,
      idempotencyKey: key,
      command: {
        operation: 'start',
        sessionId,
        input: { text: 'Check one more thing.', attachmentIds: [] },
      },
    },
  })
}

describe('Hive cleanup phase against the real SQLite Session Host store', () => {
  let temporaryRoot = ''
  let events: SessionHostEventPayload[] = []
  let releasePublisher: (() => void) | undefined

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-hive-cleanup-flow-'))
    events = []
    releasePublisher = installSessionHostEventPublisher((event) => events.push(event))
  })

  afterEach(async () => {
    releasePublisher?.()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('archives a Worker when its parent accepts it, and the Queen can still start it', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql, { state: 'ready_for_review' })
        yield* seedQueenAuthority(sql, temporaryRoot)
        const accepted = yield* executeSessionDelegationMutation({
          callerId: QUEEN_CALLER_ID,
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'accept',
            idempotencyKey: 'accept',
            command: {
              operation: 'delegation-accept',
              sessionId: 'queen',
              delegationId: 'delegation-worker',
              submissionRevision: 1,
            },
          },
        })
        const archivedAfterAccept = yield* archived(sql, 'worker')
        const attribution = yield* sql<{ readonly caller_id: string }>`
          SELECT caller_id FROM session_operations
          WHERE operation = ${'archive'} AND target_scope = ${'worker'}
        `
        const restarted = yield* startAs(QUEEN_CALLER_ID, 'worker', 'queen-restart')
        return {
          accepted: accepted.outcome,
          archivedAfterAccept,
          attribution,
          restarted: restarted.outcome,
          archivedAfterRestart: yield* archived(sql, 'worker'),
        }
      }).pipe(Effect.provide(hiveHostLayer(path.join(temporaryRoot, 'accept.sqlite')))),
    )

    expect(result.accepted).toMatchObject({
      effect: 'delegation-updated',
      delegationState: 'accepted',
    })
    expect(result.archivedAfterAccept).toBe(true)
    expect(result.attribution).toEqual([{ caller_id: QUEEN_CALLER_ID }])
    expect(result.restarted).toMatchObject({ effect: 'started-run', sessionId: 'worker' })
    expect(result.archivedAfterRestart).toBe(true)
    expect(events).toContainEqual({
      kind: 'session-list-changed',
      sessionId: 'worker',
      change: 'archived',
    })
  })

  it('waits for a cancelled Worker Run to settle before archiving it', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql, { state: 'working' })
        yield* seedQueenAuthority(sql, temporaryRoot)
        const started = yield* startAs(QUEEN_CALLER_ID, 'worker', 'queen-start')
        if (started.outcome.effect !== 'started-run') throw new Error('Worker Run did not start.')
        const runId = RunId(started.outcome.runId)
        const lifecycle = yield* SessionControlRunLifecycleRepository
        yield* lifecycle.activate({ sessionId: SessionId('worker'), runId })
        yield* executeSessionDelegationMutation({
          callerId: QUEEN_CALLER_ID,
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'cancel',
            idempotencyKey: 'cancel',
            command: {
              operation: 'delegation-cancel',
              sessionId: 'queen',
              delegationId: 'delegation-worker',
              reason: 'No longer needed.',
            },
          },
        })
        const archivedWhileRunning = yield* archived(sql, 'worker')
        yield* settleExternalSessionRun({
          sessionId: SessionId('worker'),
          runId,
          terminalStatus: 'completed',
          finalResponse: 'Stopped early.',
        })
        return { archivedWhileRunning, archivedAfterSettle: yield* archived(sql, 'worker') }
      }).pipe(Effect.provide(hiveHostLayer(path.join(temporaryRoot, 'cancel.sqlite')))),
    )

    expect(result).toEqual({ archivedWhileRunning: false, archivedAfterSettle: true })
  })

  it('never archives a Worker the user messaged, and keeps a restored Worker restored', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql, { workerId: 'talked-to', state: 'ready_for_review' })
        yield* seedHiveWorker(sql, {
          workerId: 'restored',
          state: 'ready_for_review',
          seedParent: false,
        })
        yield* seedQueenAuthority(sql, temporaryRoot)
        const userMessage = yield* startSessionRun({
          callerId: 'gui:local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'user-message',
            idempotencyKey: 'user-message',
            command: {
              operation: 'start',
              sessionId: 'talked-to',
              input: { text: 'Why this approach?', attachmentIds: [] },
            },
          },
        })
        if (userMessage.outcome.effect !== 'started-run') throw new Error('User Run did not start.')
        const userRunId = RunId(userMessage.outcome.runId)
        const lifecycle = yield* SessionControlRunLifecycleRepository
        yield* lifecycle.activate({ sessionId: SessionId('talked-to'), runId: userRunId })
        yield* settleExternalSessionRun({
          sessionId: SessionId('talked-to'),
          runId: userRunId,
          terminalStatus: 'completed',
          finalResponse: 'Because of the constraints.',
        })
        for (const workerId of ['talked-to', 'restored']) {
          yield* executeSessionDelegationMutation({
            callerId: QUEEN_CALLER_ID,
            request: {
              contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
              requestId: `accept-${workerId}`,
              idempotencyKey: `accept-${workerId}`,
              command: {
                operation: 'delegation-accept',
                sessionId: 'queen',
                delegationId: `delegation-${workerId}`,
                submissionRevision: 1,
              },
            },
          })
        }
        const restoredWasArchived = yield* archived(sql, 'restored')
        yield* organizeSession({
          callerId: 'gui:local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'restore',
            idempotencyKey: 'restore',
            command: { operation: 'unarchive', sessionId: 'restored' },
          },
        })
        const queenRun = yield* startAs('gui:local-user', 'queen', 'user-asks-queen')
        if (queenRun.outcome.effect !== 'started-run') throw new Error('Queen Run did not start.')
        const queenRunId = RunId(queenRun.outcome.runId)
        yield* lifecycle.activate({ sessionId: SessionId('queen'), runId: queenRunId })
        yield* settleExternalSessionRun({
          sessionId: SessionId('queen'),
          runId: queenRunId,
          terminalStatus: 'completed',
          finalResponse: 'Summary.',
        })
        return {
          talkedToArchived: yield* archived(sql, 'talked-to'),
          restoredWasArchived,
          restoredArchived: yield* archived(sql, 'restored'),
        }
      }).pipe(Effect.provide(hiveHostLayer(path.join(temporaryRoot, 'interaction.sqlite')))),
    )

    expect(result).toEqual({
      talkedToArchived: false,
      restoredWasArchived: true,
      restoredArchived: false,
    })
  })
})
