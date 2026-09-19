import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalSessionProfileRepository } from '../../ports/local-session-profile-repository'
import { makeLocalSessionProfileTestLayer } from './sqlite-local-session-profile-test-layer'

describe('SQLite Local Session profile queue revocation', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-profile-queue-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it("marks only the revoked caller's item in a shared Session queue", async () => {
    const layer = makeLocalSessionProfileTestLayer(
      path.join(temporaryRoot, 'shared-profile-revocation.sqlite'),
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO sessions (
            id, pi_session_id, project_path, title, archived, created_at, updated_at
          ) VALUES (
            ${'shared-root'}, ${'pi-shared-root'}, ${'/project'}, ${'Shared root'},
            ${0}, ${10}, ${10}
          )
        `
        yield* sql`
          INSERT INTO session_execution_profiles (
            session_id, profile_json, authority_origin_caller_id,
            authorization_ceiling, created_at, updated_at
          ) VALUES (
            ${'shared-root'}, ${'{"modelId":"provider/model","thinkingLevel":"medium"}'},
            ${'local-user:owner'}, ${'yolo'}, ${10}, ${10}
          )
        `
        yield* sql`
          INSERT INTO session_control_states (
            session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
          ) VALUES (${'shared-root'}, ${1}, ${null}, ${'running'}, ${2}, ${10})
        `
        for (const followUp of [
          { id: 'profile-item', position: 0, callerId: 'profile:profile-review' },
          { id: 'local-item', position: 1, callerId: 'local-user:owner' },
        ]) {
          yield* sql`
            INSERT INTO session_follow_ups (
              id, session_id, position, delivery_state, attention_reason,
              intent_json, created_at, updated_at
            ) VALUES (
              ${followUp.id}, ${'shared-root'}, ${followUp.position}, ${'pending'}, ${null},
              ${JSON.stringify({ callerId: followUp.callerId })}, ${10}, ${10}
            )
          `
        }
        const repository = yield* LocalSessionProfileRepository
        const request = {
          contractVersion: 1,
          requestId: 'revoke-shared',
          idempotencyKey: 'revoke-shared-key',
          command: { operation: 'revoke', profileName: 'review-bot' },
        } as const
        yield* repository.executeManagement({ actorCallerId: 'local-user', request, now: 500 })
        yield* repository.executeManagement({
          actorCallerId: 'local-user',
          request: { ...request, requestId: 'revoke-shared-again', idempotencyKey: 'another-key' },
          now: 600,
        })
        const followUps = yield* sql<{
          readonly id: string
          readonly delivery_state: string
          readonly attention_reason: string | null
        }>`
          SELECT id, delivery_state, attention_reason
          FROM session_follow_ups ORDER BY position
        `
        const states = yield* sql<{
          readonly queue_state: string
          readonly queue_revision: number
          readonly state_revision: number
        }>`
          SELECT queue_state, queue_revision, state_revision
          FROM session_control_states WHERE session_id = ${'shared-root'}
        `
        return { followUps, state: states[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.followUps).toEqual([
      {
        id: 'profile-item',
        delivery_state: 'needs_attention',
        attention_reason: 'profile_revoked',
      },
      { id: 'local-item', delivery_state: 'pending', attention_reason: null },
    ])
    expect(result.state).toEqual({ queue_state: 'running', queue_revision: 2, state_revision: 1 })
  })
})
