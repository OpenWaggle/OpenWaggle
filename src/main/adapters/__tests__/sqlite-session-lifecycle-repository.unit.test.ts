import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import {
  makeSessionLifecycleTestLayer,
  rootLifecycleInput,
  spawnLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

let temporaryRoot = ''

describe('SQLite Session lifecycle repository', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-lifecycle-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('atomically persists Worker, Run, shared Workspace binding, lineage, Delegation, and grant', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'spawn.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionLifecycleRepository
        const first = yield* repository.execute(spawnLifecycleInput())
        const replay = yield* repository.execute(spawnLifecycleInput())
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{
          readonly workspace_id: string
          readonly parent_session_id: string
          readonly parent_run_id: string
          readonly hive_root_session_id: string
          readonly depth: number
          readonly delegation_id: string
          readonly grant_id: string
        }>`
          SELECT
            session_workspace_bindings.workspace_id,
            session_spawn_lineage.parent_session_id,
            session_spawn_lineage.parent_run_id,
            session_spawn_lineage.hive_root_session_id,
            session_spawn_lineage.depth,
            delegation_contracts.id AS delegation_id,
            derived_child_management_grants.id AS grant_id
          FROM sessions
          JOIN session_workspace_bindings ON session_workspace_bindings.session_id = sessions.id
          JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
          JOIN delegation_contracts ON delegation_contracts.child_session_id = sessions.id
          JOIN derived_child_management_grants
            ON derived_child_management_grants.child_session_id = sessions.id
          WHERE sessions.id = ${'session-worker'}
        `
        return { first, replay, row: rows[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.replay).toEqual({ ...result.first, replayed: true })
    expect(result.first.outcome).toMatchObject({
      operation: 'spawn',
      effect: 'spawned-worker',
      sessionId: 'session-worker',
      runId: 'run-worker',
      workspaceId: 'workspace-parent',
      hiveRootSessionId: 'session-parent',
      depth: 1,
    })
    expect(result.row).toEqual({
      workspace_id: 'workspace-parent',
      parent_session_id: 'session-parent',
      parent_run_id: 'run-parent',
      hive_root_session_id: 'session-parent',
      depth: 1,
      delegation_id: 'delegation-worker',
      grant_id: 'grant-worker',
    })
  })

  it('records capacity rejection without leaving an idle child or partial lineage', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'capacity.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO sessions (
            id, pi_session_id, project_path, title, archived, created_at, updated_at
          ) VALUES (
            ${'session-existing-worker'}, ${'pi-existing-worker'}, ${'/project'},
            ${'Existing worker'}, ${0}, ${1}, ${1}
          )
        `
        yield* sql`
          INSERT INTO session_runs (
            id, session_id, status, intent_json, created_at, updated_at
          ) VALUES (
            ${'run-existing-worker'}, ${'session-existing-worker'}, ${'active'}, ${null}, ${1}, ${1}
          )
        `
        yield* sql`
          INSERT INTO session_control_states (
            session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
          ) VALUES (
            ${'session-existing-worker'}, ${1}, ${'run-existing-worker'}, ${'running'}, ${0}, ${1}
          )
        `
        yield* sql`
          INSERT INTO session_spawn_lineage (
            child_session_id, parent_session_id, parent_run_id,
            hive_root_session_id, depth, created_at
          ) VALUES (
            ${'session-existing-worker'}, ${'session-parent'}, ${'run-parent'},
            ${'session-parent'}, ${1}, ${1}
          )
        `
        const repository = yield* SessionLifecycleRepository
        const response = yield* repository.execute(spawnLifecycleInput(1))
        const children = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM sessions WHERE id = ${'session-worker'}
        `
        return { response, childCount: children[0]?.count }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome).toMatchObject({
      effect: 'rejected',
      code: 'parent_capacity_reached',
    })
    expect(result.childCount).toBe(0)
  })

  it('creates an idle independent root without a Run or Spawn lineage', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'create.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionLifecycleRepository
        const response = yield* repository.execute(rootLifecycleInput('create'))
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{
          readonly active_run_id: string | null
          readonly authorization_mode_override: string | null
          readonly authorization_ceiling: string
          readonly last_active_branch_id: string | null
          readonly branch_count: number
          readonly run_count: number
          readonly lineage_count: number
        }>`
          SELECT
            session_control_states.active_run_id,
            sessions.authorization_mode_override,
            session_execution_profiles.authorization_ceiling,
            sessions.last_active_branch_id,
            (SELECT COUNT(*) FROM session_branches WHERE session_id = sessions.id) AS branch_count,
            (SELECT COUNT(*) FROM session_runs WHERE session_id = sessions.id) AS run_count,
            (
              SELECT COUNT(*) FROM session_spawn_lineage
              WHERE child_session_id = sessions.id
            ) AS lineage_count
          FROM sessions
          JOIN session_control_states ON session_control_states.session_id = sessions.id
          JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
          WHERE sessions.id = ${'session-create'}
        `
        return { response, row: rows[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome).toEqual({
      operation: 'create',
      effect: 'created-root',
      sessionId: 'session-create',
      workspaceId: 'workspace-parent',
    })
    expect(result.row).toEqual({
      active_run_id: null,
      authorization_mode_override: null,
      authorization_ceiling: 'ask-for-approval',
      last_active_branch_id: 'session-create:main',
      branch_count: 1,
      run_count: 0,
      lineage_count: 0,
    })
  })

  it('atomically launches an independent root and records its starting Run intent', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'launch.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionLifecycleRepository
        const response = yield* repository.execute(rootLifecycleInput('launch'))
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{
          readonly status: string
          readonly active_run_id: string | null
          readonly last_active_branch_id: string | null
          readonly branch_count: number
          readonly intent_json: string
          readonly lineage_count: number
        }>`
          SELECT
            session_runs.status,
            session_control_states.active_run_id,
            sessions.last_active_branch_id,
            (SELECT COUNT(*) FROM session_branches WHERE session_id = sessions.id) AS branch_count,
            session_runs.intent_json,
            (
              SELECT COUNT(*) FROM session_spawn_lineage
              WHERE child_session_id = sessions.id
            ) AS lineage_count
          FROM sessions
          JOIN session_runs ON session_runs.session_id = sessions.id
          JOIN session_control_states ON session_control_states.session_id = sessions.id
          WHERE sessions.id = ${'session-launch'}
        `
        return { response, row: rows[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome).toEqual({
      operation: 'launch',
      effect: 'launched-root',
      sessionId: 'session-launch',
      runId: 'run-launch',
      workspaceId: 'workspace-parent',
    })
    expect(result.row).toMatchObject({
      status: 'starting',
      active_run_id: 'run-launch',
      last_active_branch_id: 'session-launch:main',
      branch_count: 1,
      lineage_count: 0,
    })
    expect(JSON.parse(result.row?.intent_json ?? '{}')).toMatchObject({
      text: 'Audit the target schema.',
      attachmentIds: ['attachment-schema'],
      callerId: 'local-user',
    })
  })

  it('rejects an independent launch when the app-wide Run ceiling is full', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'launch-ceiling.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionLifecycleRepository
        const response = yield* repository.execute({
          ...rootLifecycleInput('launch'),
          hostRunCeiling: 1,
        })
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM sessions WHERE id = ${'session-launch'}
        `
        return { response, sessionCount: rows[0]?.count }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome).toMatchObject({
      operation: 'launch',
      effect: 'rejected',
      code: 'host_run_ceiling_reached',
      hostRunCeiling: 1,
      hostActiveRuns: 1,
    })
    expect(result.sessionCount).toBe(0)
  })

  it('admits only one of two concurrent roots into the final Host Run slot', async () => {
    const layer = makeSessionLifecycleTestLayer(
      path.join(temporaryRoot, 'launch-ceiling-race.sqlite'),
    )
    const responses = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionLifecycleRepository
        const first = rootLifecycleInput('launch')
        const second = {
          ...first,
          request: {
            ...first.request,
            requestId: 'request-launch-second',
            idempotencyKey: 'idempotency-launch-second',
          },
          session: {
            sessionId: 'session-launch-second',
            piSessionId: 'pi-launch-second',
            piSessionFile: '/sessions/launch-second.jsonl',
          },
          runId: 'run-launch-second',
        }
        return yield* Effect.all(
          [
            repository.execute({ ...first, hostRunCeiling: 2 }),
            repository.execute({ ...second, hostRunCeiling: 2 }),
          ],
          { concurrency: 'unbounded' },
        )
      }).pipe(Effect.provide(layer)),
    )

    expect(
      responses.filter((response) => response.outcome.effect === 'launched-root'),
    ).toHaveLength(1)
    expect(
      responses.filter(
        (response) =>
          response.outcome.effect === 'rejected' &&
          response.outcome.code === 'host_run_ceiling_reached',
      ),
    ).toHaveLength(1)
  })
})
