import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionWorkspaceResourceRepository } from '../../ports/session-workspace-resource-repository'
import { SqliteSessionWorkspaceResourceRepositoryLive } from '../sqlite-session-workspace-resource-repository'
import { makeSessionLifecycleTestLayer } from './sqlite-session-lifecycle-test-support'

function makeLayer(filename: string) {
  const base = makeSessionLifecycleTestLayer(filename)
  return Layer.merge(base, SqliteSessionWorkspaceResourceRepositoryLive.pipe(Layer.provide(base)))
}

interface BoundSession {
  readonly id: string
  readonly archived: boolean
  readonly activeRun?: boolean
}

/** A managed worktree `/wt/feature` and the Sessions bound to it; a missing Session is dangling. */
function seed(sessions: readonly BoundSession[], dangling = false) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      INSERT INTO workspace_resources (
        id, project_path, kind, working_path, lifecycle_state,
        worktree_start_from_origin, created_at, updated_at
      ) VALUES (${'feature'}, ${'/project'}, ${'managed-worktree'}, ${'/wt/feature'},
        ${'ready'}, ${0}, ${1}, ${1})
    `
    for (const session of sessions) {
      yield* sql`
        INSERT INTO sessions (id, pi_session_id, project_path, title, archived, created_at, updated_at)
        VALUES (${session.id}, ${`pi-${session.id}`}, ${'/project'}, ${session.id},
          ${session.archived ? 1 : 0}, ${1}, ${1})
      `
      yield* sql`
        INSERT INTO session_workspace_bindings (session_id, workspace_id, bound_at)
        VALUES (${session.id}, ${'feature'}, ${1})
      `
      if (session.activeRun) {
        yield* sql`
          INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
          VALUES (${`run-${session.id}`}, ${session.id}, ${'active'}, ${null}, ${1}, ${1})
        `
        yield* sql`
          INSERT INTO session_control_states (
            session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
          ) VALUES (${session.id}, ${1}, ${`run-${session.id}`}, ${'running'}, ${0}, ${1})
        `
      }
    }
    if (dangling) {
      yield* sql`PRAGMA foreign_keys = OFF`
      yield* sql`
        INSERT INTO session_workspace_bindings (session_id, workspace_id, bound_at)
        VALUES (${'gone'}, ${'feature'}, ${1})
      `
    }
  })
}

function admit(admitArchivedBindings: boolean) {
  return Effect.gen(function* () {
    const repository = yield* SessionWorkspaceResourceRepository
    return yield* repository.admitManagedWorktreeRemoval({
      resourceId: 'feature',
      reservationId: 'feature',
      projectPath: '/project',
      workingPath: '/wt/feature',
      ...(admitArchivedBindings ? { admitArchivedBindings: true } : {}),
    })
  })
}

function lifecycle() {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ readonly lifecycle_state: string }>`
      SELECT lifecycle_state FROM workspace_resources WHERE id = ${'feature'}
    `
    return rows[0]?.lifecycle_state ?? 'deleted'
  })
}

describe('Settings removal of a worktree archived Sessions are bound to (ADR 0060)', () => {
  let root = ''
  let file = 0

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-removal-admission-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  function run<A>(
    effect: Effect.Effect<A, Error, SqlClient.SqlClient | SessionWorkspaceResourceRepository>,
  ) {
    file += 1
    return Effect.runPromise(
      effect.pipe(Effect.provide(makeLayer(path.join(root, `${String(file)}.sqlite`)))),
    )
  }

  it('admits when every bound Session is archived and idle, and keeps their binding', async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* seed([
          { id: 'a', archived: true },
          { id: 'b', archived: true },
        ])
        const admission = yield* admit(true)
        const releasing = yield* lifecycle()
        if (admission.status !== 'reserved') return { admission, releasing, after: '' }
        const repository = yield* SessionWorkspaceResourceRepository
        yield* repository.finalizeManagedWorktreeRemoval({
          resourceId: admission.resourceId,
          createdReservation: admission.createdReservation,
          removed: true,
        })
        return {
          admission,
          releasing,
          after: yield* lifecycle(),
          bindings: yield* repository.countBindings('feature'),
        }
      }),
    )

    expect(result).toEqual({
      admission: { status: 'reserved', resourceId: 'feature', createdReservation: false },
      releasing: 'releasing',
      // Restoring a Session then offers to recreate the worktree from its kept branch.
      after: 'ready',
      bindings: 2,
    })
  })

  it.each([
    [
      'a Session that is not archived',
      [
        { id: 'a', archived: true },
        { id: 'b', archived: false },
      ],
      false,
    ],
    ['an archived Session with a Run', [{ id: 'a', archived: true, activeRun: true }], false],
    ['a binding whose Session is gone', [{ id: 'a', archived: true }], true],
  ] as const)('refuses while %s is bound', async (_case, sessions, dangling) => {
    const result = await run(
      Effect.gen(function* () {
        yield* seed(sessions, dangling)
        return { admission: yield* admit(true), state: yield* lifecycle() }
      }),
    )
    expect(result).toEqual({ admission: { status: 'unavailable' }, state: 'ready' })
  })

  it('refuses any binding without the archived-bindings admission', async () => {
    const admission = await run(
      Effect.gen(function* () {
        yield* seed([{ id: 'a', archived: true }])
        return yield* admit(false)
      }),
    )
    expect(admission).toEqual({ status: 'unavailable' })
  })

  it('deletes the Workspace resource of a removed worktree nothing is bound to', async () => {
    const state = await run(
      Effect.gen(function* () {
        yield* seed([])
        const admission = yield* admit(false)
        if (admission.status !== 'reserved') return 'not reserved'
        yield* (yield* SessionWorkspaceResourceRepository).finalizeManagedWorktreeRemoval({
          resourceId: admission.resourceId,
          createdReservation: false,
          removed: true,
        })
        return yield* lifecycle()
      }),
    )
    expect(state).toBe('deleted')
  })
})
