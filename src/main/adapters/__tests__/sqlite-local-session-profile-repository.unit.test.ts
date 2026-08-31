import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalSessionProfileRepository } from '../../ports/local-session-profile-repository'
import { makeLocalSessionProfileTestLayer } from './sqlite-local-session-profile-test-layer'

describe('SQLite Local Session profile repository', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-profile-repo-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('loads strict policy and records authentication without credential material', async () => {
    const layer = makeLocalSessionProfileTestLayer(path.join(temporaryRoot, 'profiles.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* LocalSessionProfileRepository
        const profile = yield* repository.findForAuthentication('review-bot')
        yield* repository.recordAuthentication({
          profileId: 'profile-review',
          accepted: true,
          clientKind: 'mcp',
          clientVersion: 'test',
          now: 2000,
        })
        yield* repository.recordAuthentication({
          profileId: 'profile-review',
          accepted: false,
          clientKind: 'cli',
          clientVersion: 'test-2',
          now: 3000,
        })
        const sql = yield* SqlClient.SqlClient
        const audit = yield* sql<{
          readonly action: string
          readonly detail_json: string
        }>`
          SELECT action, detail_json
          FROM session_client_profile_audit
          WHERE profile_id = ${'profile-review'}
          ORDER BY id
        `
        const rows = yield* sql<{ readonly last_authenticated_at: number | null }>`
          SELECT last_authenticated_at
          FROM session_client_profiles
          WHERE id = ${'profile-review'}
        `
        return { profile, audit, lastAuthenticatedAt: rows[0]?.last_authenticated_at }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.profile).toEqual({
      id: 'profile-review',
      name: 'review-bot',
      credentialVerifier: 'verifier',
      capabilities: ['sessions:read', 'sessions:message'],
      scope: { projectPaths: ['/project'] },
      authorizationCeiling: 'ask-for-approval',
      revokedAt: null,
    })
    expect(result.audit).toEqual([
      {
        action: 'authenticated',
        detail_json: JSON.stringify({ clientKind: 'mcp', clientVersion: 'test' }),
      },
      {
        action: 'authentication_failed',
        detail_json: JSON.stringify({ clientKind: 'cli', clientVersion: 'test-2' }),
      },
    ])
    expect(result.lastAuthenticatedAt).toBe(2000)
    expect(JSON.stringify(result.audit)).not.toContain('verifier')
  })

  it('creates, replays, rotates, and revokes profiles without journaling bearer material', async () => {
    const layer = makeLocalSessionProfileTestLayer(
      path.join(temporaryRoot, 'profile-management.sqlite'),
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* LocalSessionProfileRepository
        const createRequest = {
          contractVersion: 1,
          requestId: 'create-request',
          idempotencyKey: 'create-key',
          command: {
            operation: 'create',
            name: 'worker-client',
            credential: 'bearer-material-never-persisted',
            capabilities: ['sessions:read'],
            scope: { projectPaths: ['/project'] },
            authorizationCeiling: 'ask-for-approval',
          },
        } as const
        const create = yield* repository.executeManagement({
          actorCallerId: 'local-user',
          request: createRequest,
          preparedCredential: { verifier: 'verifier-v1', fingerprint: 'fingerprint-v1' },
          now: 100,
        })
        const replay = yield* repository.executeManagement({
          actorCallerId: 'local-user',
          request: createRequest,
          preparedCredential: { verifier: 'unused-replay-verifier', fingerprint: 'fingerprint-v1' },
          now: 101,
        })
        const rotate = yield* repository.executeManagement({
          actorCallerId: 'local-user',
          request: {
            contractVersion: 1,
            requestId: 'rotate-request',
            idempotencyKey: 'rotate-key',
            command: {
              operation: 'rotate',
              profileName: 'worker-client',
              credential: 'new-bearer-material',
            },
          },
          preparedCredential: { verifier: 'verifier-v2', fingerprint: 'fingerprint-v2' },
          now: 200,
        })
        const revoke = yield* repository.executeManagement({
          actorCallerId: 'local-user',
          request: {
            contractVersion: 1,
            requestId: 'revoke-request',
            idempotencyKey: 'revoke-key',
            command: { operation: 'revoke', profileName: 'worker-client' },
          },
          now: 300,
        })
        const sql = yield* SqlClient.SqlClient
        const journal = yield* sql<{ readonly request_json: string }>`
          SELECT request_json FROM session_operations
          WHERE operation LIKE ${'access:%'} ORDER BY id
        `
        const stored = yield* sql<{
          readonly credential_verifier: string
          readonly revoked_at: number | null
        }>`
          SELECT credential_verifier, revoked_at FROM session_client_profiles
          WHERE name = ${'worker-client'}
        `
        return { create, replay, rotate, revoke, journal, stored: stored[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.create.outcome.effect).toBe('profile-created')
    expect(result.replay).toEqual({ ...result.create, replayed: true })
    expect(result.rotate.outcome.effect).toBe('profile-rotated')
    expect(result.revoke.outcome.effect).toBe('profile-revoked')
    expect(result.stored).toEqual({ credential_verifier: 'verifier-v2', revoked_at: 300 })
    expect(JSON.stringify(result.journal)).not.toContain('bearer-material')
    expect(JSON.stringify(result.journal)).toContain('fingerprint-v1')
  })

  it('revokes live authority chains and preserves queued work as needs-attention', async () => {
    const layer = makeLocalSessionProfileTestLayer(
      path.join(temporaryRoot, 'profile-revocation.sqlite'),
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO sessions (
            id, pi_session_id, project_path, title, archived, created_at, updated_at
          ) VALUES (
            ${'profile-root'}, ${'pi-profile-root'}, ${'/project'}, ${'Profile root'},
            ${0}, ${10}, ${10}
          )
        `
        yield* sql`
          INSERT INTO session_execution_profiles (
            session_id, profile_json, authority_origin_caller_id,
            authorization_ceiling, created_at, updated_at
          ) VALUES (
            ${'profile-root'}, ${'{"modelId":"provider/model","thinkingLevel":"medium"}'},
            ${'profile:profile-review'}, ${'ask-for-approval'}, ${10}, ${10}
          )
        `
        yield* sql`
          INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
          VALUES (
            ${'profile-run'}, ${'profile-root'}, ${'active'},
            ${'{"callerId":"profile:profile-review"}'}, ${10}, ${10}
          )
        `
        yield* sql`
          INSERT INTO session_control_states (
            session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
          ) VALUES (
            ${'profile-root'}, ${1}, ${'profile-run'}, ${'running'}, ${1}, ${10}
          )
        `
        yield* sql`
          INSERT INTO session_follow_ups (
            id, session_id, position, delivery_state, attention_reason,
            intent_json, created_at, updated_at
          ) VALUES (
            ${'profile-follow-up'}, ${'profile-root'}, ${0}, ${'pending'}, ${null},
            ${'{"callerId":"profile:profile-review"}'}, ${10}, ${10}
          )
        `
        const repository = yield* LocalSessionProfileRepository
        const response = yield* repository.executeManagement({
          actorCallerId: 'local-user',
          request: {
            contractVersion: 1,
            requestId: 'revoke-review',
            idempotencyKey: 'revoke-review-key',
            command: { operation: 'revoke', profileName: 'review-bot' },
          },
          now: 500,
        })
        const states = yield* sql<{
          active_run_id: string | null
          queue_state: string
        }>`SELECT active_run_id, queue_state FROM session_control_states`
        const followUps = yield* sql<{
          delivery_state: string
          attention_reason: string | null
        }>`SELECT delivery_state, attention_reason FROM session_follow_ups`
        return { response, state: states[0], followUp: followUps[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({
      response: {
        outcome: {
          effect: 'profile-revoked',
          interruptedRuns: [{ sessionId: 'profile-root', runId: 'profile-run' }],
        },
      },
      state: { active_run_id: null, queue_state: 'paused' },
      followUp: { delivery_state: 'needs_attention', attention_reason: 'profile_revoked' },
    })
  })
})
