import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
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
})
