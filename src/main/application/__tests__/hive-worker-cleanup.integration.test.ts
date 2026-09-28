import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
  QUEEN_CALLER_ID,
  seedHiveWorker,
} from '../../adapters/__tests__/hive-worker-cleanup-fixture'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { startSessionRun } from '../session-control-service'
import { executeSessionDelegationMutation } from '../session-delegation-service'
import { settleExternalSessionRun } from '../session-external-run-coordinator'
import { organizeSession } from '../session-organization-service'
import {
  archived,
  archiveStateJournal,
  commandHostLayer,
  controlCommandAs,
  delegationCommand,
  hiveHostLayer,
  seedQueenAuthority,
  startAs,
  useHiveHostTestContext,
  waitForSessionIdle,
} from './hive-worker-cleanup-host.test-harness'

describe('Hive cleanup phase against the real SQLite Session Host store', () => {
  const host = useHiveHostTestContext('openwaggle-hive-cleanup-flow-')

  it('archives a Worker when its parent accepts it, and restores it when the Queen restarts it', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql, { state: 'ready_for_review' })
        yield* seedQueenAuthority(sql, host.temporaryRoot)
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
        const restarted = yield* controlCommandAs(QUEEN_CALLER_ID, 'queen-restart', {
          operation: 'start',
          sessionId: 'worker',
          input: { text: 'Check one more thing.', attachmentIds: [] },
        })
        const archivedAfterRestart = yield* archived(sql, 'worker')
        yield* waitForSessionIdle('worker')
        return {
          accepted: accepted.outcome,
          archivedAfterAccept,
          attribution,
          restarted: restarted.outcome,
          archivedAfterRestart,
          archivedAfterRestartedRun: yield* archived(sql, 'worker'),
          journal: yield* archiveStateJournal(sql, 'worker'),
        }
      }).pipe(Effect.provide(commandHostLayer(path.join(host.temporaryRoot, 'accept.sqlite')))),
    )

    expect(result.accepted).toMatchObject({
      effect: 'delegation-updated',
      delegationState: 'accepted',
    })
    expect(result.archivedAfterAccept).toBe(true)
    expect(result.attribution).toEqual([{ caller_id: QUEEN_CALLER_ID }])
    expect(result.restarted).toMatchObject({ effect: 'started-run', sessionId: 'worker' })
    expect(result.archivedAfterRestart).toBe(false)
    // The cleanup archive key names the accept that archived it, so the settled Run replays it.
    expect(result.archivedAfterRestartedRun).toBe(false)
    expect(result.journal).toEqual([
      { caller_id: QUEEN_CALLER_ID, operation: 'archive' },
      { caller_id: QUEEN_CALLER_ID, operation: 'unarchive' },
    ])
    expect(host.events).toContainEqual({
      kind: 'session-list-changed',
      sessionId: 'worker',
      change: 'archived',
    })
    expect(host.events).toContainEqual({
      kind: 'session-list-changed',
      sessionId: 'worker',
      change: 'unarchived',
    })
  })

  it('waits for a cancelled Worker Run to settle before archiving it', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql, { state: 'working' })
        yield* seedQueenAuthority(sql, host.temporaryRoot)
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
      }).pipe(Effect.provide(hiveHostLayer(path.join(host.temporaryRoot, 'cancel.sqlite')))),
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
        yield* seedQueenAuthority(sql, host.temporaryRoot)
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
      }).pipe(Effect.provide(hiveHostLayer(path.join(host.temporaryRoot, 'interaction.sqlite')))),
    )

    expect(result).toEqual({
      talkedToArchived: false,
      restoredWasArchived: true,
      restoredArchived: false,
    })
  })
  it('archives the parent Worker once its last nested Delegation is accepted', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql, { workerId: 'lead' })
        yield* seedHiveWorker(sql, {
          workerId: 'helper',
          parentId: 'lead',
          seedParent: false,
          state: 'ready_for_review',
        })
        yield* seedQueenAuthority(sql, host.temporaryRoot)
        // The Queen already accepted the lead; it stays only because its helper is unfinished.
        const accepted = yield* delegationCommand('session-agent:lead:run-lead', 'lead-accepts', {
          operation: 'delegation-accept',
          sessionId: 'lead',
          delegationId: 'delegation-helper',
        })
        return {
          accepted: accepted.outcome.effect,
          helperArchived: yield* archived(sql, 'helper'),
          leadArchived: yield* archived(sql, 'lead'),
          leadJournal: yield* archiveStateJournal(sql, 'lead'),
        }
      }).pipe(Effect.provide(hiveHostLayer(path.join(host.temporaryRoot, 'nested.sqlite')))),
    )

    expect(result).toEqual({
      accepted: 'delegation-updated',
      helperArchived: true,
      leadArchived: true,
      leadJournal: [{ caller_id: QUEEN_CALLER_ID, operation: 'archive' }],
    })
  })
})
