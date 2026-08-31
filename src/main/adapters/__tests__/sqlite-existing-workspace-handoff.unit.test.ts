import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  organizeSession,
  recoverPendingSessionHandoffs,
} from '../../application/session-organization-service'
import { SessionOrganizationRepository } from '../../ports/session-organization-repository'
import type { PreparedWorkspaceHandoff } from '../../ports/session-workspace-handoff-service'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'

function request(sessionId = 'session-target', idempotencyKey = 'existing-key') {
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: `${idempotencyKey}-request`,
    idempotencyKey,
    command: {
      operation: 'handoff',
      sessionId,
      workspace: { mode: 'existing', workspaceId: 'workspace-existing' },
    },
  } as const
}

function prepared(snapshotRef = 'refs/openwaggle/test-source') {
  return {
    transfer: 'deferred-existing',
    workspaceId: 'workspace-existing',
    projectPath: '/project',
    sourceWorkingPath: '/project',
    workingPath: '/project-existing',
    sourceHead: 'source-head',
    snapshotRef,
    targetSnapshotRef: `${snapshotRef}-target`,
  } satisfies PreparedWorkspaceHandoff
}

function insertTarget(sql: SqlClient.SqlClient) {
  return sql`
    INSERT INTO workspace_resources (
      id, project_path, kind, working_path, lifecycle_state,
      worktree_branch, worktree_base_ref, worktree_start_from_origin, created_at, updated_at
    ) VALUES (
      ${'workspace-existing'}, ${'/project'}, ${'managed-worktree'}, ${'/project-existing'},
      ${'ready'}, ${'ow/existing'}, ${'source-head'}, ${0}, ${1000}, ${1000}
    )
  `
}

describe('SQLite existing Workspace handoff', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-existing-handoff-'))
  })
  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('reserves the target before transfer and rejects a racing admission', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'race.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* insertTarget(sql)
        yield* sql`INSERT INTO sessions (id, project_path) VALUES (${'session-racer'}, ${'/project'})`
        yield* sql`
          INSERT INTO workspace_resources (
            id, project_path, kind, working_path, lifecycle_state,
            worktree_start_from_origin, created_at, updated_at
          ) VALUES (
            ${'workspace-racer'}, ${'/project'}, ${'managed-worktree'}, ${'/project-racer'},
            ${'ready'}, ${0}, ${1000}, ${1000}
          )
        `
        yield* sql`
          INSERT INTO session_workspace_bindings (session_id, workspace_id, bound_at)
          VALUES (${'session-racer'}, ${'workspace-racer'}, ${1000})
        `
        yield* sql`
          INSERT INTO session_control_states (
            session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
          ) VALUES (${'session-racer'}, ${0}, ${null}, ${'running'}, ${0}, ${1000})
        `
        const repository = yield* SessionOrganizationRepository
        const first = yield* repository.admitExistingHandoff({
          callerId: 'first-caller',
          request: request(),
          preparedHandoff: prepared(),
        })
        const reserved = yield* sql<{
          readonly lifecycle_state: string
          readonly bound_workspace_id: string
          readonly operation_status: string
        }>`
          SELECT workspace_resources.lifecycle_state,
            session_workspace_bindings.workspace_id AS bound_workspace_id,
            session_operations.status AS operation_status
          FROM workspace_resources
          JOIN session_workspace_bindings ON session_workspace_bindings.session_id = ${'session-target'}
          JOIN session_operations ON session_operations.target_scope = ${'session-target'}
          WHERE workspace_resources.id = ${'workspace-existing'}
        `
        const raced = yield* repository.admitExistingHandoff({
          callerId: 'second-caller',
          request: request('session-racer', 'racing-key'),
          preparedHandoff: prepared('refs/openwaggle/racing-source'),
        })
        return { first, raced, reserved: reserved[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.first.status).toBe('admitted')
    expect(result.reserved).toEqual({
      lifecycle_state: 'materializing',
      bound_workspace_id: 'workspace-local',
      operation_status: 'pending',
    })
    expect(result.raced).toMatchObject({
      status: 'completed',
      response: { outcome: { effect: 'rejected', code: 'workspace_unavailable' } },
    })
  })

  it.each([
    { rollbackFails: false, state: 'ready', seedRef: null, released: true },
    {
      rollbackFails: true,
      state: 'failed',
      seedRef: 'refs/openwaggle/test-source',
      released: false,
    },
  ])('compensates a failed transfer with rollbackFails=$rollbackFails', async (scenario) => {
    const events: string[] = []
    const layer = makeSessionControlTestLayer(
      path.join(temporaryRoot, `${scenario.state}.sqlite`),
      {
        prepare: () => Effect.succeed(prepared()),
        apply: () => Effect.fail(new Error('apply failed')),
        rollback: () =>
          scenario.rollbackFails
            ? Effect.fail(new Error('target changed after apply'))
            : Effect.sync(() => events.push('rollback')),
        complete: () => Effect.sync(() => events.push('release')),
      },
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* insertTarget(sql)
        const response = yield* organizeSession({ callerId: 'local-user', request: request() })
        const rows = yield* sql<{
          readonly workspace_id: string
          readonly lifecycle_state: string
          readonly handoff_seed_ref: string | null
          readonly operation_status: string
        }>`
          SELECT session_workspace_bindings.workspace_id, workspace_resources.lifecycle_state,
            workspace_resources.handoff_seed_ref, session_operations.status AS operation_status
          FROM session_workspace_bindings
          JOIN workspace_resources ON workspace_resources.id = ${'workspace-existing'}
          JOIN session_operations ON session_operations.target_scope = ${'session-target'}
          WHERE session_workspace_bindings.session_id = ${'session-target'}
        `
        return { response, row: rows[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(events.includes('release')).toBe(scenario.released)
    expect(result.response.outcome).toMatchObject({
      effect: 'rejected',
      code: 'workspace_target_transfer_failed',
    })
    expect(result.row).toEqual({
      workspace_id: 'workspace-local',
      lifecycle_state: scenario.state,
      handoff_seed_ref: scenario.seedRef,
      operation_status: 'completed',
    })
  })

  it('switches the binding only after the target transfer succeeds', async () => {
    const events: string[] = []
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'success.sqlite'), {
      prepare: () => Effect.succeed(prepared()),
      apply: () => Effect.sync(() => events.push('apply')),
      rollback: () => Effect.sync(() => events.push('rollback')),
      complete: () => Effect.sync(() => events.push('release')),
    })
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* insertTarget(sql)
        const response = yield* organizeSession({ callerId: 'local-user', request: request() })
        const rows = yield* sql<{
          readonly workspace_id: string
          readonly lifecycle_state: string
          readonly operation_status: string
        }>`
          SELECT session_workspace_bindings.workspace_id, workspace_resources.lifecycle_state,
            session_operations.status AS operation_status
          FROM session_workspace_bindings
          JOIN workspace_resources ON workspace_resources.id = session_workspace_bindings.workspace_id
          JOIN session_operations ON session_operations.target_scope = ${'session-target'}
          WHERE session_workspace_bindings.session_id = ${'session-target'}
        `
        return { response, row: rows[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(events).toEqual(['apply', 'release'])
    expect(result.response.outcome).toMatchObject({
      effect: 'session-handed-off',
      previousWorkspaceId: 'workspace-local',
      workspaceId: 'workspace-existing',
    })
    expect(result.row).toEqual({
      workspace_id: 'workspace-existing',
      lifecycle_state: 'ready',
      operation_status: 'completed',
    })
  })

  it.each(['before-apply', 'after-apply'] as const)(
    'resumes a pending handoff after host loss at %s',
    async (crashPoint) => {
      const events: string[] = []
      let targetContainsAppliedSeed = crashPoint === 'after-apply'
      const layer = makeSessionControlTestLayer(
        path.join(temporaryRoot, `recovery-${crashPoint}.sqlite`),
        {
          prepare: () => Effect.succeed(prepared()),
          apply: () =>
            Effect.sync(() => {
              events.push(targetContainsAppliedSeed ? 'verify-applied' : 'apply')
              targetContainsAppliedSeed = true
            }),
          rollback: () => Effect.sync(() => events.push('rollback')),
          complete: () => Effect.sync(() => events.push('release')),
        },
      )
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* insertTarget(sql)
          const repository = yield* SessionOrganizationRepository
          const admission = yield* repository.admitExistingHandoff({
            callerId: 'local-user',
            request: request(),
            preparedHandoff: prepared(),
          })
          const [operation] = yield* sql<{ readonly id: number }>`
            SELECT id FROM session_operations WHERE status = ${'pending'}
          `
          const recovery = yield* recoverPendingSessionHandoffs([
            {
              operationId: String(operation?.id),
              callerId: 'local-user',
              idempotencyKey: request().idempotencyKey,
              requestJson: JSON.stringify(request().command),
            },
          ])
          const [row] = yield* sql<{
            readonly workspace_id: string
            readonly lifecycle_state: string
            readonly operation_status: string
          }>`
            SELECT session_workspace_bindings.workspace_id, workspace_resources.lifecycle_state,
              session_operations.status AS operation_status
            FROM session_workspace_bindings
            JOIN workspace_resources
              ON workspace_resources.id = session_workspace_bindings.workspace_id
            JOIN session_operations ON session_operations.target_scope = ${'session-target'}
            WHERE session_workspace_bindings.session_id = ${'session-target'}
          `
          return { admission, recovery, row }
        }).pipe(Effect.provide(layer)),
      )

      expect(result.admission.status).toBe('admitted')
      expect(events).toEqual([crashPoint === 'after-apply' ? 'verify-applied' : 'apply', 'release'])
      expect(result.recovery).toEqual([
        expect.objectContaining({
          _tag: 'Right',
          right: expect.objectContaining({
            outcome: expect.objectContaining({ effect: 'session-handed-off' }),
          }),
        }),
      ])
      expect(result.row).toEqual({
        workspace_id: 'workspace-existing',
        lifecycle_state: 'ready',
        operation_status: 'completed',
      })
    },
  )
})
