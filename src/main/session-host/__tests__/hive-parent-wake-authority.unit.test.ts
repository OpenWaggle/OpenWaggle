import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runHiveWakeTest } from '../../adapters/__tests__/sqlite-hive-parent-wake-test-support'
import { resolveHiveWakeAuthority } from '../hive-parent-wake-authority'

const PROFILE_CAPABILITIES = ['sessions:discover', 'sessions:read', 'sessions:message']

function insertProfile(
  sql: SqlClient.SqlClient,
  input: {
    readonly id: string
    readonly ceiling: 'yolo' | 'ask-for-approval'
    readonly capabilities?: readonly string[]
    readonly revokedAt?: number
  },
) {
  return sql`
    INSERT INTO session_client_profiles (
      id, name, credential_verifier, capabilities_json, scope_json, authorization_ceiling,
      revoked_at, created_at, updated_at
    ) VALUES (
      ${input.id}, ${input.id}, ${'verifier'},
      ${JSON.stringify(input.capabilities ?? PROFILE_CAPABILITIES)}, ${JSON.stringify({ all: true })},
      ${input.ceiling}, ${input.revokedAt ?? null}, ${1}, ${1}
    )
  `
}

/** The parent's latest Run, started by `callerId`, as the wake candidate names it. */
function wakeAuthorityFor(
  sql: SqlClient.SqlClient,
  callerId: string,
  runAuthorizationOverride?: 'yolo' | 'ask-for-approval',
) {
  return Effect.gen(function* () {
    yield* sql`
      UPDATE session_runs SET status = ${'completed'}, intent_json = ${JSON.stringify({ callerId })}
      WHERE id = ${'run-parent'}
    `
    yield* sql`
      UPDATE session_execution_profiles SET authorization_ceiling = ${'yolo'}
      WHERE session_id = ${'session-parent'}
    `
    return yield* resolveHiveWakeAuthority(sql, {
      parentSessionId: 'session-parent',
      latestRunId: 'run-parent',
      callerId,
      ...(runAuthorizationOverride ? { runAuthorizationOverride } : {}),
      piSessionFile: null,
    })
  })
}

describe('Hive wake authority', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-hive-wake-authority-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('keeps only a narrowing Run mode override of the latest Run', async () => {
    const authority = await runHiveWakeTest(
      root,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return {
          plain: yield* wakeAuthorityFor(sql, 'local-user'),
          asked: yield* wakeAuthorityFor(sql, 'local-user', 'ask-for-approval'),
          yolo: yield* wakeAuthorityFor(sql, 'local-user', 'yolo'),
        }
      }),
    )

    // A yolo override was for that Run alone: the wake runs in the Session's own mode, which the
    // user may have changed since.
    expect(authority).toEqual({
      plain: {},
      asked: { runAuthorizationOverride: 'ask-for-approval' },
      yolo: {},
    })
  })

  it('clamps a wake for an ask-for-approval CLI profile on a yolo Session', async () => {
    const authority = await runHiveWakeTest(
      root,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* insertProfile(sql, { id: 'asker', ceiling: 'ask-for-approval' })
        return yield* wakeAuthorityFor(sql, 'profile:asker')
      }),
    )

    // Without the clamp the wake Run would run yolo for a caller that never could.
    expect(authority).toEqual({ runAuthorizationOverride: 'ask-for-approval' })
  })

  it('refuses a wake for a profile that was revoked or may no longer message', async () => {
    const authority = await runHiveWakeTest(
      root,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* insertProfile(sql, { id: 'gone', ceiling: 'yolo', revokedAt: 2 })
        yield* insertProfile(sql, {
          id: 'reader',
          ceiling: 'yolo',
          capabilities: ['sessions:discover', 'sessions:read'],
        })
        return {
          revoked: yield* wakeAuthorityFor(sql, 'profile:gone'),
          narrowed: yield* wakeAuthorityFor(sql, 'profile:reader'),
        }
      }),
    )

    expect(authority).toEqual({
      revoked: { blocked: 'profile_revoked' },
      narrowed: { blocked: 'authority_changed' },
    })
  })

  it('refuses a wake for a Session agent that no longer reaches the parent', async () => {
    const authority = await runHiveWakeTest(
      root,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        // The agent of a Session that is gone, or was never this parent's: nothing grants it.
        return yield* wakeAuthorityFor(sql, 'session-agent:session-gone:run-gone')
      }),
    )

    // Follow-up delivery reads a missing source Session as revoked authority, and so does a wake.
    expect(authority).toEqual({ blocked: 'profile_revoked' })
  })
})
