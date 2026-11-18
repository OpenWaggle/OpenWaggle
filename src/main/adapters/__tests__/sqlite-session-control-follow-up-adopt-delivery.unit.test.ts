import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { noUndeliveredSteers } from '../../application/__tests__/agent-steering-test-layer'
import { promoteSessionFollowUp } from '../../application/session-control-promotion-service'
import { mutateSessionQueue, submitSessionMessage } from '../../application/session-control-service'
import { AgentSteeringService } from '../../ports/agent-steering-service'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { loadSessionControlState } from '../sqlite-session-control-state'
import { followUpEditLayer, idleQueue, settleRun } from './sqlite-follow-up-edit-hold.test-support'
import {
  adopt,
  PROFILE,
  SESSION,
  STUCK_INTENT,
  startRunAndQueueStuckFollowUp,
  USER,
} from './sqlite-session-control-follow-up-adopt.test-support'

describe('SQLite Session control: delivering an adopted Follow-up', () => {
  let tmpRoot = ''

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-follow-up-adopt-delivery-'))
  })

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('delivers a Follow-up sent as the desktop user from the queue its revoked author paused', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* idleQueue([])
        yield* submitSessionMessage({
          callerId: USER,
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-message',
            idempotencyKey: 'message',
            command: {
              operation: 'message',
              sessionId: SESSION,
              input: { text: 'Start working.', attachmentIds: [] },
            },
          },
        })
        // Queued by a CLI profile that is gone by the time its Run would start.
        yield* sql`
          INSERT INTO session_follow_ups (
            id, session_id, position, delivery_state, intent_json, created_at, updated_at
          ) VALUES (
            ${'follow-up-stuck'}, ${SESSION}, ${0}, ${'pending'},
            ${JSON.stringify(STUCK_INTENT)}, ${1}, ${1}
          )
        `
        // Settlement finds the author's authority gone: the real needs-attention pause.
        yield* settleRun()
        const paused = yield* loadSessionControlState(sql, SESSION)
        const adopted = yield* adopt({
          key: 'send-as-me',
          desktopUser: true,
          expectedQueueRevision: paused.followUpQueue.revision,
        })
        return { paused, adopted, after: yield* loadSessionControlState(sql, SESSION) }
      }).pipe(Effect.provide(followUpEditLayer(tmpRoot, 'paused.sqlite'))),
    )

    expect(result.paused.run).toEqual({ state: 'idle' })
    expect(result.paused.followUpQueue).toMatchObject({
      state: 'paused',
      items: [{ deliveryState: 'needs_attention', attentionReason: 'profile_revoked' }],
    })
    expect(result.paused.followUpQueue).not.toHaveProperty('pauseReason')
    expect(result.adopted.outcome).toMatchObject({
      operation: 'queue-adopt',
      effect: 'started-run',
      runId: 'run-next',
      followUpId: 'follow-up-stuck',
    })
    expect(result.after.followUpQueue).toMatchObject({ state: 'running', items: [] })
    expect(result.after.run).toMatchObject({
      state: 'starting',
      intent: { callerId: USER, authorCallerId: PROFILE },
    })
  })

  it('leaves a queue the user paused paused after sending its Follow-up as the desktop user', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* idleQueue([{ id: 'follow-up-stuck' }])
        yield* sql`
          UPDATE session_follow_ups
          SET delivery_state = ${'needs_attention'}, attention_reason = ${'profile_revoked'},
            intent_json = ${JSON.stringify(STUCK_INTENT)}
          WHERE id = ${'follow-up-stuck'}
        `
        const revision = (yield* loadSessionControlState(sql, SESSION)).followUpQueue.revision
        yield* mutateSessionQueue({
          callerId: USER,
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-pause',
            idempotencyKey: 'pause',
            command: {
              operation: 'queue-pause',
              sessionId: SESSION,
              expectedQueueRevision: revision,
            },
          },
        })
        const paused = yield* loadSessionControlState(sql, SESSION)
        const adopted = yield* adopt({
          key: 'send-as-me',
          desktopUser: true,
          expectedQueueRevision: paused.followUpQueue.revision,
        })
        return { adopted, after: yield* loadSessionControlState(sql, SESSION) }
      }).pipe(Effect.provide(followUpEditLayer(tmpRoot, 'requested.sqlite'))),
    )

    expect(result.adopted.outcome).toMatchObject({
      effect: 'queue-updated',
      queueState: 'paused',
    })
    expect(result.after.run).toEqual({ state: 'idle' })
    expect(result.after.followUpQueue).toMatchObject({
      state: 'paused',
      pauseReason: 'requested',
      items: [{ deliveryState: 'pending', intent: { callerId: USER } }],
    })
  })

  it("resolves and releases an adopted Follow-up's attachments as its author's when promoted", async () => {
    const ownerOf = new Map([['attachment-1', PROFILE]])
    const resolve = vi.fn(
      (input: { readonly attachmentIds: readonly string[]; readonly ownerCallerId: string }) =>
        input.attachmentIds.every((id) => ownerOf.get(id) === input.ownerCallerId)
          ? Effect.succeed([])
          : Effect.fail(new Error('Attachment not owned by this caller.')),
    )
    const release = vi.fn((_input: { readonly ownerCallerId: string }) => Effect.void)
    const steer = vi.fn(() =>
      Effect.succeed({ accepted: true as const, receipt: { delivery: 'handled' as const } }),
    )
    const layer = Layer.merge(
      followUpEditLayer(tmpRoot, 'promote.sqlite'),
      Layer.merge(
        Layer.succeed(AgentSteeringService, { steer, ...noUndeliveredSteers }),
        Layer.succeed(SessionControlAttachmentService, {
          prepare: () => Effect.succeed([]),
          bind: () => Effect.void,
          cleanupUnreferenced: () => Effect.void,
          resolve,
          release,
        }),
      ),
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const revision = yield* startRunAndQueueStuckFollowUp({ attachmentIds: ['attachment-1'] })
        yield* SessionControlRunLifecycleRepository.pipe(
          Effect.flatMap((runs) =>
            runs.activate({ sessionId: SessionId(SESSION), runId: RunId('run-next') }),
          ),
        )
        const adopted = yield* adopt({
          key: 'adopt',
          desktopUser: true,
          expectedQueueRevision: revision,
        })
        const promoted = yield* promoteSessionFollowUp({
          callerId: USER,
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-promote',
            idempotencyKey: 'promote',
            command: {
              operation: 'promote',
              sessionId: SESSION,
              expectedRunId: 'run-next',
              followUpId: 'follow-up-stuck',
            },
          },
        })
        return { adopted, promoted, after: yield* loadSessionControlState(sql, SESSION) }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.adopted.outcome).toMatchObject({ effect: 'queue-updated' })
    expect(result.promoted.outcome).toMatchObject({
      effect: 'promoted-follow-up',
      followUpId: 'follow-up-stuck',
    })
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentIds: ['attachment-1'], ownerCallerId: PROFILE }),
    )
    expect(release).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentIds: ['attachment-1'], ownerCallerId: PROFILE }),
    )
    expect(steer).toHaveBeenCalledOnce()
    expect(result.after.followUpQueue.items).toEqual([])
  })
})
