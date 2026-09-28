import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
  QUEEN_CALLER_ID,
  seedHiveWorker,
} from '../../adapters/__tests__/hive-worker-cleanup-fixture'
import { AgentRunInterruptionService } from '../../ports/agent-run-interruption-service'
import { AgentSteeringService } from '../../ports/agent-steering-service'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import { organizeSession } from '../session-organization-service'
import {
  archived,
  archiveStateJournal,
  commandHostLayer,
  controlCommandAs,
  delegationCommand,
  seedQueenAuthority,
  useHiveHostTestContext,
  waitForSessionIdle,
} from './hive-worker-cleanup-host.test-harness'

/** A later Run of the same Queen, as when the Queen resumes a Worker in a new turn. */
const QUEEN_LATER_CALLER_ID = 'session-agent:queen:run-queen-later'

const input = { text: 'Check one more thing.', attachmentIds: [] } as const

/** Seeds an accepted Worker and lets the Queen's accept trigger the Hive cleanup archive. */
function seedCleanupArchivedWorker(sql: SqlClient.SqlClient, projectPath: string) {
  return Effect.gen(function* () {
    yield* seedHiveWorker(sql, { state: 'ready_for_review' })
    yield* seedQueenAuthority(sql, projectPath)
    yield* delegationCommand(QUEEN_CALLER_ID, 'accept', {
      operation: 'delegation-accept',
      sessionId: 'queen',
      delegationId: 'delegation-worker',
    })
    if (!(yield* archived(sql, 'worker'))) throw new Error('Hive cleanup did not archive.')
  })
}

/** The archived Worker's earlier Run is still live, for example one started before this fix. */
function reviveWorkerRun(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    yield* sql`UPDATE session_runs SET status = ${'active'} WHERE id = ${'run-worker'}`
    yield* sql`
      UPDATE session_control_states SET active_run_id = ${'run-worker'}
      WHERE session_id = ${'worker'}
    `
  })
}

/** Live-Run collaborators that accept the steer or the interruption. */
function withLiveRunServices<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.provideService(AgentSteeringService, {
      steer: () =>
        Effect.succeed({
          accepted: true,
          receipt: fromPartial({ delivery: 'queued' }),
        } as const),
    }),
    Effect.provideService(AgentRunInterruptionService, {
      requestInterrupt: () => Effect.succeed({ accepted: true } as const),
      interrupt: () => Effect.succeed({ accepted: true } as const),
    }),
    Effect.provideService(
      SessionControlAttachmentService,
      fromPartial({
        resolve: () => Effect.succeed([]),
        release: () => Effect.void,
        cleanupUnreferenced: () => Effect.void,
      }),
    ),
  )
}

function restoredByQueen(
  host: ReturnType<typeof useHiveHostTestContext>,
  result: {
    readonly archived: boolean
    readonly journal: readonly { readonly caller_id: string; readonly operation: string }[]
  },
) {
  expect(result.archived).toBe(false)
  expect(result.journal).toEqual([
    { caller_id: QUEEN_CALLER_ID, operation: 'archive' },
    { caller_id: QUEEN_LATER_CALLER_ID, operation: 'unarchive' },
  ])
  expect(host.events).toContainEqual({
    kind: 'session-list-changed',
    sessionId: 'worker',
    change: 'unarchived',
  })
}

describe('Hive cleanup and agent resumption against the real SQLite Session Host store', () => {
  const host = useHiveHostTestContext('openwaggle-hive-cleanup-agent-')

  it('restores a cleanup-archived Worker the Queen starts, and keeps it after the Run', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedCleanupArchivedWorker(sql, host.temporaryRoot)
        host.events.length = 0
        const started = yield* controlCommandAs(QUEEN_LATER_CALLER_ID, 'queen-start', {
          operation: 'start',
          sessionId: 'worker',
          input,
        })
        const archivedWhileRunning = yield* archived(sql, 'worker')
        yield* waitForSessionIdle('worker')
        return {
          started: started.outcome.effect,
          archivedWhileRunning,
          archived: yield* archived(sql, 'worker'),
          journal: yield* archiveStateJournal(sql, 'worker'),
        }
      }).pipe(Effect.provide(commandHostLayer(path.join(host.temporaryRoot, 'start.sqlite')))),
    )

    expect(result.started).toBe('started-run')
    expect(result.archivedWhileRunning).toBe(false)
    restoredByQueen(host, result)
  })

  it('restores a cleanup-archived Worker the Queen sends a Follow-up', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedCleanupArchivedWorker(sql, host.temporaryRoot)
        host.events.length = 0
        const followUp = yield* controlCommandAs(QUEEN_LATER_CALLER_ID, 'queen-follow-up', {
          operation: 'follow-up',
          sessionId: 'worker',
          input,
        })
        yield* waitForSessionIdle('worker')
        return {
          followUp: followUp.outcome.effect,
          archived: yield* archived(sql, 'worker'),
          journal: yield* archiveStateJournal(sql, 'worker'),
        }
      }).pipe(Effect.provide(commandHostLayer(path.join(host.temporaryRoot, 'follow-up.sqlite')))),
    )

    expect(result.followUp).toBe('started-run')
    restoredByQueen(host, result)
  })

  it.each([
    ['steer', { operation: 'steer', sessionId: 'worker', expectedRunId: 'run-worker', input }],
    ['replace', { operation: 'replace', sessionId: 'worker', expectedRunId: 'run-worker', input }],
  ] as const)(
    'restores a cleanup-archived Worker whose live Run the Queen %ss',
    async (operation, command) => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* seedCleanupArchivedWorker(sql, host.temporaryRoot)
          yield* reviveWorkerRun(sql)
          host.events.length = 0
          const reply = yield* withLiveRunServices(
            controlCommandAs(QUEEN_LATER_CALLER_ID, `queen-${operation}`, command),
          )
          return {
            reply: reply.outcome.effect,
            archived: yield* archived(sql, 'worker'),
            journal: yield* archiveStateJournal(sql, 'worker'),
          }
        }).pipe(
          Effect.provide(commandHostLayer(path.join(host.temporaryRoot, `${operation}.sqlite`))),
        ),
      )

      expect(result.reply).toBe(operation === 'steer' ? 'steered-run' : 'replaced-run')
      restoredByQueen(host, result)
    },
  )

  it('restores a cleanup-archived Worker when the Queen reopens its Delegation', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedCleanupArchivedWorker(sql, host.temporaryRoot)
        host.events.length = 0
        const reopened = yield* controlCommandAs(QUEEN_LATER_CALLER_ID, 'queen-reopen', {
          operation: 'delegation-reopen',
          sessionId: 'queen',
          delegationId: 'delegation-worker',
          reason: 'The error path is still missing.',
        })
        return {
          reopened: reopened.outcome,
          archived: yield* archived(sql, 'worker'),
          journal: yield* archiveStateJournal(sql, 'worker'),
        }
      }).pipe(Effect.provide(commandHostLayer(path.join(host.temporaryRoot, 'reopen.sqlite')))),
    )

    expect(result.reopened).toMatchObject({
      effect: 'delegation-updated',
      delegationState: 'revision_requested',
    })
    restoredByQueen(host, result)
  })

  it('restores a cleanup-archived Worker when the Queen requests a revision', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedCleanupArchivedWorker(sql, host.temporaryRoot)
        // The archived Worker resubmitted, for example after a reopen before this fix.
        yield* sql`
          UPDATE delegation_contracts SET state = ${'ready_for_review'}
          WHERE id = ${'delegation-worker'}
        `
        host.events.length = 0
        const revision = yield* delegationCommand(QUEEN_LATER_CALLER_ID, 'queen-revision', {
          operation: 'delegation-request-revision',
          sessionId: 'queen',
          delegationId: 'delegation-worker',
        })
        return {
          revision: revision.outcome,
          archived: yield* archived(sql, 'worker'),
          journal: yield* archiveStateJournal(sql, 'worker'),
        }
      }).pipe(Effect.provide(commandHostLayer(path.join(host.temporaryRoot, 'revision.sqlite')))),
    )

    expect(result.revision).toMatchObject({
      effect: 'delegation-updated',
      delegationState: 'revision_requested',
    })
    restoredByQueen(host, result)
  })

  it('leaves a Worker archived explicitly by the Queen or the user archived', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql, { workerId: 'shelved-by-queen' })
        yield* seedHiveWorker(sql, { workerId: 'shelved-by-user', seedParent: false })
        yield* seedQueenAuthority(sql, host.temporaryRoot)
        for (const [sessionId, callerId] of [
          ['shelved-by-queen', QUEEN_CALLER_ID],
          ['shelved-by-user', 'gui:local-user'],
        ] as const) {
          yield* organizeSession({
            callerId,
            request: {
              contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
              requestId: `shelve-${sessionId}`,
              idempotencyKey: `shelve-${sessionId}`,
              command: { operation: 'archive', sessionId },
            },
          })
        }
        host.events.length = 0
        const replies = []
        for (const sessionId of ['shelved-by-queen', 'shelved-by-user']) {
          const reply = yield* controlCommandAs(QUEEN_LATER_CALLER_ID, `queen-start-${sessionId}`, {
            operation: 'start',
            sessionId,
            input,
          })
          replies.push(reply.outcome.effect)
          yield* waitForSessionIdle(sessionId)
        }
        return {
          replies,
          queenShelved: yield* archived(sql, 'shelved-by-queen'),
          userShelved: yield* archived(sql, 'shelved-by-user'),
        }
      }).pipe(Effect.provide(commandHostLayer(path.join(host.temporaryRoot, 'explicit.sqlite')))),
    )

    expect(result).toEqual({
      replies: ['started-run', 'started-run'],
      queenShelved: true,
      userShelved: true,
    })
    expect(host.events).not.toContainEqual(
      expect.objectContaining({ kind: 'session-list-changed', change: 'unarchived' }),
    )
  })
})
