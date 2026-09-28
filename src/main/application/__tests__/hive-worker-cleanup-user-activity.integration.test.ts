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
import { executeSessionControlMutation } from '../session-control-command-service'
import { settleExternalSessionRun } from '../session-external-run-coordinator'
import { organizeSession } from '../session-organization-service'
import {
  archived,
  archiveStateJournal,
  commandHostLayer,
  delegationCommand,
  hiveHostLayer,
  seedQueenAuthority,
  startAs,
  useHiveHostTestContext,
  waitForSessionIdle,
} from './hive-worker-cleanup-host.test-harness'

describe('Hive cleanup and user activity against the real SQLite Session Host store', () => {
  const host = useHiveHostTestContext('openwaggle-hive-cleanup-user-')

  it('never archives a Worker whose Delegation the user accepted from the CLI', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql, { state: 'ready_for_review' })
        yield* seedQueenAuthority(sql, host.temporaryRoot)
        const accepted = yield* delegationCommand('local-user:machine', 'cli-accept', {
          operation: 'delegation-accept',
          sessionId: 'queen',
          delegationId: 'delegation-worker',
        })
        const queenRun = yield* startAs('gui:local-user', 'queen', 'user-asks-queen')
        if (queenRun.outcome.effect !== 'started-run') throw new Error('Queen Run did not start.')
        const queenRunId = RunId(queenRun.outcome.runId)
        const lifecycle = yield* SessionControlRunLifecycleRepository
        yield* lifecycle.activate({ sessionId: SessionId('queen'), runId: queenRunId })
        yield* settleExternalSessionRun({
          sessionId: SessionId('queen'),
          runId: queenRunId,
          terminalStatus: 'completed',
          finalResponse: 'Summary.',
        })
        return {
          accepted: accepted.outcome,
          archived: yield* archived(sql, 'worker'),
          journal: yield* archiveStateJournal(sql, 'worker'),
        }
      }).pipe(Effect.provide(hiveHostLayer(path.join(host.temporaryRoot, 'cli-accept.sqlite')))),
    )

    expect(result.accepted).toMatchObject({
      effect: 'delegation-updated',
      delegationState: 'accepted',
    })
    expect(result).toMatchObject({ archived: false, journal: [] })
  })

  it('keeps a Worker the user sent back for revision even after the Queen accepts it', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql, { state: 'ready_for_review' })
        yield* seedQueenAuthority(sql, host.temporaryRoot)
        const revision = yield* delegationCommand('local-user:machine', 'cli-revision', {
          operation: 'delegation-request-revision',
          sessionId: 'queen',
          delegationId: 'delegation-worker',
        })
        yield* sql`
          UPDATE delegation_contracts SET state = ${'ready_for_review'}
          WHERE id = ${'delegation-worker'}
        `
        const accepted = yield* delegationCommand(QUEEN_CALLER_ID, 'queen-accept', {
          operation: 'delegation-accept',
          sessionId: 'queen',
          delegationId: 'delegation-worker',
        })
        return {
          revision: revision.outcome.effect,
          accepted: accepted.outcome.effect,
          archived: yield* archived(sql, 'worker'),
        }
      }).pipe(Effect.provide(hiveHostLayer(path.join(host.temporaryRoot, 'cli-revision.sqlite')))),
    )

    expect(result).toEqual({
      revision: 'delegation-updated',
      accepted: 'delegation-updated',
      archived: false,
    })
  })

  it('restores a cleanup-archived Worker when the user messages it, but not an explicit archive', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql, { state: 'ready_for_review' })
        yield* seedHiveWorker(sql, { workerId: 'shelved', seedParent: false })
        yield* seedQueenAuthority(sql, host.temporaryRoot)
        yield* delegationCommand(QUEEN_CALLER_ID, 'accept', {
          operation: 'delegation-accept',
          sessionId: 'queen',
          delegationId: 'delegation-worker',
        })
        const archivedByCleanup = yield* archived(sql, 'worker')
        yield* organizeSession({
          callerId: QUEEN_CALLER_ID,
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'queen-shelves',
            idempotencyKey: 'queen-shelves',
            command: { operation: 'archive', sessionId: 'shelved' },
          },
        })
        host.events.length = 0
        const replies = []
        for (const sessionId of ['worker', 'shelved']) {
          const reply = yield* executeSessionControlMutation({
            callerId: 'gui:local-user',
            request: {
              contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
              requestId: `user-message-${sessionId}`,
              idempotencyKey: `user-message-${sessionId}`,
              command: {
                operation: 'message',
                sessionId,
                input: { text: 'Why did you pick this approach?', attachmentIds: [] },
              },
            },
          })
          replies.push(reply.outcome.effect)
          yield* waitForSessionIdle(sessionId)
        }
        return {
          archivedByCleanup,
          replies,
          workerArchived: yield* archived(sql, 'worker'),
          workerJournal: yield* archiveStateJournal(sql, 'worker'),
          shelvedArchived: yield* archived(sql, 'shelved'),
        }
      }).pipe(Effect.provide(commandHostLayer(path.join(host.temporaryRoot, 'restore.sqlite')))),
    )

    expect(result).toEqual({
      archivedByCleanup: true,
      replies: ['started-run', 'started-run'],
      workerArchived: false,
      workerJournal: [
        { caller_id: QUEEN_CALLER_ID, operation: 'archive' },
        { caller_id: 'gui:local-user', operation: 'unarchive' },
      ],
      shelvedArchived: true,
    })
    expect(host.events).toContainEqual({
      kind: 'session-list-changed',
      sessionId: 'worker',
      change: 'unarchived',
    })
    expect(host.events).not.toContainEqual({
      kind: 'session-list-changed',
      sessionId: 'shelved',
      change: 'unarchived',
    })
  })
})
