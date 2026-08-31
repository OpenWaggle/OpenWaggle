import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as ManagedRuntime from 'effect/ManagedRuntime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promoteSessionFollowUp } from '../../application/session-control-promotion-service'
import { mutateSessionQueue } from '../../application/session-control-service'
import { SessionControlOperationPendingError } from '../../errors'
import { AgentSteeringService } from '../../ports/agent-steering-service'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import { SessionControlOperationJournal } from '../../ports/session-control-operation-journal'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { reservedFollowUpIds } from '../sqlite-session-follow-up-reservation'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'

let temporaryRoot = ''

describe('SQLite Session Control queue and operation journal', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-control-'))
  })

  afterEach(async () => {
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('persists queue reordering without transient position collisions', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'reorder.sqlite'))
    const intent = JSON.stringify({
      text: 'Queued work',
      attachmentIds: [],
      callerId: 'local-user',
      acceptedAt: 1000,
      idempotencyKey: 'seed',
    })
    const orderedIds = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_follow_ups (
            id, session_id, position, delivery_state, intent_json, created_at, updated_at
          ) VALUES
            (${'follow-up-first'}, ${'session-target'}, ${0}, ${'pending'}, ${intent}, ${1000}, ${1000}),
            (${'follow-up-second'}, ${'session-target'}, ${1}, ${'pending'}, ${intent}, ${1000}, ${1000})
        `
        yield* sql`
          UPDATE session_control_states SET state_revision = ${2}, queue_revision = ${2}
          WHERE session_id = ${'session-target'}
        `
        yield* mutateSessionQueue({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-reorder',
            idempotencyKey: 'idempotency-reorder',
            command: {
              operation: 'queue-reorder',
              sessionId: 'session-target',
              expectedQueueRevision: 2,
              orderedFollowUpIds: ['follow-up-second', 'follow-up-first'],
            },
          },
        })
        const rows = yield* sql<{ readonly id: string }>`
          SELECT id FROM session_follow_ups
          WHERE session_id = ${'session-target'} ORDER BY position ASC
        `
        return rows.map((row) => row.id)
      }).pipe(Effect.provide(layer)),
    )

    expect(orderedIds).toEqual(['follow-up-second', 'follow-up-first'])
  })

  it('claims an external side effect before dispatch and replays only its completed outcome', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'external-operation.sqlite'))
    const request = {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-promote-failure',
      idempotencyKey: 'idempotency-promote-failure',
      command: {
        operation: 'promote',
        sessionId: 'session-target',
        expectedRunId: 'run-next',
        followUpId: 'follow-up-reserved',
      },
    } as const
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const journal = yield* SessionControlOperationJournal
        const first = yield* journal.claim({
          callerId: 'local-user',
          request,
          decide: () => ({ accepted: true }),
        })
        const pendingReplay = yield* journal.claim({
          callerId: 'local-user',
          request,
          decide: () => {
            throw new Error('A replay must not reevaluate the decision.')
          },
        })
        const reservedBefore = yield* reservedFollowUpIds(sql, 'session-target')
        const outcome = {
          operation: 'promote',
          effect: 'rejected',
          sessionId: 'session-target',
          code: 'steering_failed',
        } as const
        yield* journal.complete({ callerId: 'local-user', request, outcome })
        const reservedAfter = yield* reservedFollowUpIds(sql, 'session-target')
        const completedReplay = yield* journal.claim({
          callerId: 'local-user',
          request,
          decide: () => {
            throw new Error('A completed replay must not reevaluate the decision.')
          },
        })
        return { first, pendingReplay, completedReplay, reservedBefore, reservedAfter }
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual({
      first: { status: 'claimed', stateRevision: 0 },
      pendingReplay: { status: 'pending', replayed: true },
      completedReplay: {
        status: 'completed',
        replayed: true,
        outcome: {
          operation: 'promote',
          effect: 'rejected',
          sessionId: 'session-target',
          code: 'steering_failed',
        },
      },
      reservedBefore: new Set(['follow-up-reserved']),
      reservedAfter: new Set(),
    })
  })

  it('durably reserves one queued Follow-up while its promotion side effect is in flight', async () => {
    const databasePath = path.join(temporaryRoot, 'promotion-reservation.sqlite')
    const baseLayer = makeSessionControlTestLayer(databasePath)
    let releaseSteering: () => void = () => undefined
    const steeringBarrier = new Promise<void>((resolve) => {
      releaseSteering = resolve
    })
    const steer = vi.fn(() =>
      Effect.promise(async () => {
        await steeringBarrier
        return { accepted: true as const }
      }),
    )
    const layer = Layer.merge(
      baseLayer,
      Layer.merge(
        Layer.succeed(AgentSteeringService, { steer }),
        Layer.succeed(SessionControlAttachmentService, {
          prepare: () => Effect.succeed([]),
          bind: () => Effect.void,
          cleanupUnreferenced: () => Effect.void,
          resolve: () => Effect.succeed([]),
          release: () => Effect.void,
        }),
      ),
    )
    const runtime = ManagedRuntime.make(layer)
    const request = (idempotencyKey: string) => ({
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: `request-${idempotencyKey}`,
      idempotencyKey,
      command: {
        operation: 'promote' as const,
        sessionId: 'session-target',
        expectedRunId: 'run-active',
        followUpId: 'follow-up-next',
      },
    })
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const intent = JSON.stringify({
          text: 'Promote once.',
          attachmentIds: [],
          callerId: 'local-user',
          acceptedAt: 1000,
          idempotencyKey: 'queued',
        })
        yield* sql`
          INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
          VALUES (${'run-active'}, ${'session-target'}, ${'active'}, ${null}, ${1000}, ${1000})
        `
        yield* sql`
          UPDATE session_control_states SET active_run_id = ${'run-active'}, state_revision = ${1}
          WHERE session_id = ${'session-target'}
        `
        yield* sql`
          INSERT INTO session_follow_ups (
            id, session_id, position, delivery_state, intent_json, created_at, updated_at
          ) VALUES (
            ${'follow-up-next'}, ${'session-target'}, ${0}, ${'pending'}, ${intent}, ${1000}, ${1000}
          )
        `
      }),
    )

    const first = runtime.runPromise(
      promoteSessionFollowUp({ callerId: 'local-user', request: request('first') }),
    )
    await vi.waitFor(() => expect(steer).toHaveBeenCalledOnce())
    await expect(
      runtime.runPromise(
        Effect.flip(promoteSessionFollowUp({ callerId: 'local-user', request: request('second') })),
      ),
    ).resolves.toBeInstanceOf(SessionControlOperationPendingError)
    expect(steer).toHaveBeenCalledOnce()

    await expect(
      runtime.runPromise(
        mutateSessionQueue({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-withdraw-reserved',
            idempotencyKey: 'withdraw-reserved',
            command: {
              operation: 'queue-withdraw',
              sessionId: 'session-target',
              followUpIds: ['follow-up-next'],
            },
          },
        }),
      ),
    ).resolves.toMatchObject({ outcome: { effect: 'rejected', code: 'follow_up_reserved' } })

    let settlementCompleted = false
    const settlement = runtime
      .runPromise(
        Effect.gen(function* () {
          const lifecycle = yield* SessionControlRunLifecycleRepository
          return yield* lifecycle.settle({
            sessionId: SessionId('session-target'),
            runId: RunId('run-active'),
            nextRunId: RunId('run-after-settlement'),
            terminalStatus: 'completed',
          })
        }),
      )
      .then((result) => {
        settlementCompleted = true
        return result
      })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(settlementCompleted).toBe(false)

    releaseSteering()
    await expect(first).resolves.toMatchObject({ outcome: { effect: 'promoted-follow-up' } })
    const settlementResult = await settlement
    expect(settlementResult).toMatchObject({ accepted: true })
    expect('scheduled' in settlementResult).toBe(false)
    await expect(
      runtime.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql`SELECT id FROM session_follow_ups WHERE id = ${'follow-up-next'}`
        }),
      ),
    ).resolves.toEqual([])
    await runtime.dispose()
  })
})
