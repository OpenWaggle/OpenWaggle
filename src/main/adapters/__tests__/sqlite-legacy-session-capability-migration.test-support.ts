import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import type { SessionCapability } from '@shared/types/session-capability'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach } from 'vitest'
import { DEFAULT_BEFORE_SCHEDULED_TASKS } from '../../domain/session-control/session-capability-restriction'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { SCHEDULED_TASK_MIGRATION_ID } from '../../services/session-host-schema-identity'

/** When migration 70 (Scheduled tasks) ran; Sessions before it stored the older default grant. */
export const SCHEDULED_TASKS_APPLIED_AT = '2026-10-23T18:56:36.684Z'
export const BEFORE = Date.parse(SCHEDULED_TASKS_APPLIED_AT) - 60_000
export const AFTER = Date.parse(SCHEDULED_TASKS_APPLIED_AT) + 60_000
export const LEGACY: readonly SessionCapability[] = DEFAULT_BEFORE_SCHEDULED_TASKS

let tmpRoot = ''

/** Gives each test its own database directory. */
export function useLegacyCapabilityDatabase() {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-legacy-capabilities-'))
  })
  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })
}

function databaseLayer() {
  const sqlite = SqliteClient.layer({
    filename: path.join(tmpRoot, 'host.sqlite'),
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })
  const schema = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe(`CREATE TABLE _migrations (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
      )`)
      yield* sql.unsafe(`CREATE TABLE settings_store (
        key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL
      )`)
      yield* sql.unsafe(`CREATE TABLE session_execution_profiles (
        session_id TEXT PRIMARY KEY, profile_json TEXT NOT NULL,
        resolved_agent_snapshot_json TEXT, authority_origin_caller_id TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )`)
      yield* sql.unsafe(`CREATE TABLE session_agent_origins (
        session_id TEXT PRIMARY KEY, caller_id TEXT NOT NULL, created_at INTEGER NOT NULL
      )`)
      yield* sql.unsafe(`CREATE TABLE session_operations (
        caller_id TEXT NOT NULL, operation TEXT NOT NULL, status TEXT NOT NULL, outcome_json TEXT
      )`)
      yield* sql.unsafe(`CREATE TABLE session_spawn_lineage (
        child_session_id TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL
      )`)
      yield* sql`INSERT INTO _migrations (id, name, applied_at)
        VALUES (${SCHEDULED_TASK_MIGRATION_ID}, 'scheduled-tasks', ${SCHEDULED_TASKS_APPLIED_AT})`
    }).pipe(Effect.provide(sqlite)),
  )
  return Layer.merge(sqlite, schema)
}

export function run<A>(effect: Effect.Effect<A, unknown, SqlClient.SqlClient>) {
  return Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(databaseLayer()))))
}

interface ProfileSeed {
  readonly id: string
  readonly capabilities?: readonly SessionCapability[]
  readonly createdAt: number
  readonly origin?: string
  readonly definitionCapabilities?: readonly SessionCapability[]
  /** Stored as is instead of a profile built from the other fields. */
  readonly rawProfile?: string
  readonly rawDefinition?: string
}

export function seedProfile(seed: ProfileSeed) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const profile = {
      modelId: 'openai/gpt-5.5',
      thinkingLevel: 'high',
      ...(seed.capabilities ? { sessionCapabilities: seed.capabilities } : {}),
    }
    const definition =
      seed.rawDefinition ??
      (seed.definitionCapabilities
        ? JSON.stringify({ name: 'narrow', sessionCapabilities: seed.definitionCapabilities })
        : null)
    yield* sql`INSERT INTO session_execution_profiles (session_id, profile_json,
      resolved_agent_snapshot_json, authority_origin_caller_id, created_at, updated_at)
      VALUES (${seed.id}, ${seed.rawProfile ?? JSON.stringify(profile)}, ${definition},
        ${seed.origin ?? 'gui:local-user'}, ${seed.createdAt}, ${seed.createdAt})`
  })
}

/** The agent of `creator` created, launched or forked `child` (`session_agent_origins`). */
export function agentCreated(child: string, creator: string) {
  return SqlClient.SqlClient.pipe(
    Effect.flatMap(
      (sql) => sql`INSERT INTO session_agent_origins (session_id, caller_id, created_at)
        VALUES (${child}, ${`session-agent:${creator}:run-${creator}`}, ${AFTER})`,
    ),
  )
}

export function forked(child: string, source: string, callerId = 'gui:local-user') {
  return SqlClient.SqlClient.pipe(
    Effect.flatMap(
      (sql) => sql`INSERT INTO session_operations (caller_id, operation, status, outcome_json)
        VALUES (${callerId}, 'fork', 'completed', ${JSON.stringify({
          operation: 'fork',
          effect: 'forked-session',
          sessionId: child,
          sourceSessionId: source,
        })})`,
    ),
  )
}

export function spawned(child: string, parent: string) {
  return SqlClient.SqlClient.pipe(
    Effect.flatMap(
      (sql) => sql`INSERT INTO session_spawn_lineage (child_session_id, parent_session_id)
        VALUES (${child}, ${parent})`,
    ),
  )
}

export function storedCapabilities() {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ readonly session_id: string; readonly capabilities: string | null }>`
      SELECT session_id, json_extract(profile_json, '$.sessionCapabilities') AS capabilities
      FROM session_execution_profiles ORDER BY session_id
    `
    return Object.fromEntries(
      rows.map((row) => [
        row.session_id,
        row.capabilities === null ? 'default' : JSON.parse(row.capabilities),
      ]),
    )
  })
}
