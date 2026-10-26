import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import { SessionWorkspaceResourceRepository } from '../../ports/session-workspace-resource-repository'
import { SqliteSessionWorkspaceResourceRepositoryLive } from '../sqlite-session-workspace-resource-repository'
import {
  makeSessionLifecycleTestLayer,
  rootLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

function makeLayer(filename: string) {
  const base = makeSessionLifecycleTestLayer(filename)
  return Layer.merge(base, SqliteSessionWorkspaceResourceRepositoryLive.pipe(Layer.provide(base)))
}

describe('SQLite Session Workspace removal admission', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-worktree-removal-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('counts archived members as durable bindings while excluding the departing Session', async () => {
    const layer = makeLayer(path.join(temporaryRoot, 'durable-bindings.sqlite'))
    await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const repository = yield* SessionWorkspaceResourceRepository
        const members = yield* sql<{ readonly session_id: string }>`
          SELECT session_id FROM session_workspace_bindings WHERE workspace_id = 'workspace-parent'
        `
        expect(members).toHaveLength(1)
        const member = members[0]
        if (!member) throw new Error('Fixture has no workspace member')
        yield* sql`UPDATE sessions SET archived = 1 WHERE id = ${member.session_id}`
        expect(yield* repository.countBindings('workspace-parent')).toBe(1)
        expect(yield* repository.countActiveBindings('workspace-parent')).toBe(0)
        expect(
          yield* repository.countBindings('workspace-parent', SessionId(member.session_id)),
        ).toBe(0)
      }).pipe(Effect.provide(layer)),
    )
  })

  it('atomically reserves only a ready unbound managed worktree', async () => {
    const layer = makeLayer(path.join(temporaryRoot, 'reserve.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`DELETE FROM session_workspace_bindings WHERE workspace_id = ${'workspace-parent'}`
        yield* sql`
          UPDATE workspace_resources SET kind = ${'managed-worktree'}
          WHERE id = ${'workspace-parent'}
        `
        const repository = yield* SessionWorkspaceResourceRepository
        const input = {
          resourceId: 'workspace-parent',
          reservationId: 'unused-reservation',
          projectPath: '/project',
          workingPath: '/project',
        }
        const first = yield* repository.admitManagedWorktreeRemoval(input)
        const second = yield* repository.admitManagedWorktreeRemoval(input)
        const rows = yield* sql<{ readonly lifecycle_state: string }>`
          SELECT lifecycle_state FROM workspace_resources WHERE id = ${'workspace-parent'}
        `
        return { first, second, state: rows[0]?.lifecycle_state }
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual({
      first: {
        status: 'reserved',
        resourceId: 'workspace-parent',
        createdReservation: false,
      },
      second: { status: 'unavailable' },
      state: 'releasing',
    })
  })

  it('rejects a zero-binding worktree that is already changing lifecycle state', async () => {
    const layer = makeLayer(path.join(temporaryRoot, 'materializing.sqlite'))
    const admission = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`DELETE FROM session_workspace_bindings WHERE workspace_id = ${'workspace-parent'}`
        yield* sql`
          UPDATE workspace_resources
          SET kind = ${'managed-worktree'}, lifecycle_state = ${'materializing'}
          WHERE id = ${'workspace-parent'}
        `
        return yield* (yield* SessionWorkspaceResourceRepository).admitManagedWorktreeRemoval({
          resourceId: 'workspace-parent',
          reservationId: 'unused-reservation',
          projectPath: '/project',
          workingPath: '/project',
        })
      }).pipe(Effect.provide(layer)),
    )

    expect(admission).toEqual({ status: 'unavailable' })
  })

  it('prevents an existing-workspace launch from binding a removal reservation', async () => {
    const layer = makeLayer(path.join(temporaryRoot, 'lifecycle-race.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE workspace_resources SET lifecycle_state = ${'releasing'}
          WHERE id = ${'workspace-parent'}
        `
        return yield* Effect.either(
          (yield* SessionLifecycleRepository).execute(rootLifecycleInput('launch')),
        )
      }).pipe(Effect.provide(layer)),
    )

    expect(result._tag).toBe('Left')
  })
  it('lists the Sessions that can keep a worktree in use, with their Workspace', async () => {
    const layer = makeLayer(path.join(temporaryRoot, 'occupants.sqlite'))
    const occupants = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const repository = yield* SessionWorkspaceResourceRepository
        yield* sql`
          INSERT INTO workspace_resources (
            id, project_path, kind, working_path, lifecycle_state,
            worktree_start_from_origin, created_at, updated_at
          ) VALUES
            (${'managed-archived'}, ${'/project'}, ${'managed-worktree'}, ${'/wt/archived'},
              ${'ready'}, ${0}, ${1}, ${1}),
            (${'local-archived'}, ${'/other'}, ${'local'}, ${'/other'},
              ${'ready'}, ${0}, ${1}, ${1})
        `
        yield* sql`
          INSERT INTO sessions (id, pi_session_id, project_path, title, archived, created_at, updated_at)
          VALUES
            (${'session-archived-owner'}, ${'pi-archived-owner'}, ${'/project'}, ${'Owner'}, ${1}, ${1}, ${1}),
            (${'session-archived-local'}, ${'pi-archived-local'}, ${'/project'}, ${'Gone'}, ${1}, ${1}, ${1})
        `
        yield* sql`
          INSERT INTO session_workspace_bindings (session_id, workspace_id, bound_at)
          VALUES (${'session-archived-owner'}, ${'managed-archived'}, ${1}),
            (${'session-archived-local'}, ${'local-archived'}, ${1})
        `
        return yield* repository.listWorkspaceOccupants()
      }).pipe(Effect.provide(layer)),
    )

    // An archived local Session with no Run can neither block nor own a worktree, so it is left out.
    expect([...occupants].sort((a, b) => a.sessionId.localeCompare(b.sessionId))).toEqual([
      {
        sessionId: 'session-archived-owner',
        title: 'Owner',
        archived: true,
        activeRun: false,
        sessionProjectPath: '/project',
        workspace: {
          id: 'managed-archived',
          kind: 'managed-worktree',
          workingPath: '/wt/archived',
        },
      },
      {
        sessionId: 'session-parent',
        title: 'Parent',
        archived: false,
        activeRun: true,
        sessionProjectPath: '/project',
        workspace: { id: 'workspace-parent', kind: 'local', workingPath: '/project' },
      },
    ])
  })
})
