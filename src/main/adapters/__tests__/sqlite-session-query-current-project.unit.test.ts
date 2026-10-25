import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  executeSessionQuery as executeQuery,
  makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

const WORKTREE = '/worktrees/project-a/workspace-wt'

/**
 * The shared fixture has a Queen and a share-parent Worker checked out at /project-a and an
 * unrelated Session at /project-b. This adds a second Worker of the Queen in its own managed
 * worktree, with an accepted Delegation, the shape issue #352 found hidden by default.
 */
function addWorktreeWorker(runtime: ReturnType<typeof makeRuntime>) {
  return runtime.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        INSERT INTO sessions (id, pi_session_id, project_path, title, created_at, updated_at)
        VALUES (${'worktree-worker'}, ${'pi-wt'}, ${'/project-a'}, ${'Worktree reviewer'}, ${1}, ${4})
      `
      yield* sql`
        INSERT INTO workspace_resources (
          id, project_path, kind, working_path, lifecycle_state, created_at, updated_at
        ) VALUES (
          ${'workspace-wt'}, ${'/project-a'}, ${'managed-worktree'}, ${WORKTREE},
          ${'ready'}, ${1}, ${1}
        )
      `
      yield* sql`
        INSERT INTO session_workspace_bindings (session_id, workspace_id, bound_at)
        VALUES (${'worktree-worker'}, ${'workspace-wt'}, ${1})
      `
      yield* sql`
        INSERT INTO session_spawn_lineage (
          child_session_id, parent_session_id, parent_run_id,
          hive_root_session_id, depth, created_at
        ) VALUES (${'worktree-worker'}, ${'queen'}, ${'run-queen'}, ${'queen'}, ${1}, ${1})
      `
      yield* sql`
        INSERT INTO delegation_contracts (
          id, parent_session_id, child_session_id, state,
          current_specification_revision, created_at, updated_at
        ) VALUES (
          ${'delegation-wt'}, ${'queen'}, ${'worktree-worker'}, ${'accepted'}, ${1}, ${1}, ${5}
        )
      `
      yield* sql`
        INSERT INTO delegation_specifications (
          delegation_id, revision, specification_json, authored_by, created_at
        ) VALUES (
          ${'delegation-wt'}, ${1},
          ${'{"objective":"Review","deliverables":[],"acceptanceCriteria":[],"resourceReferences":[]}'},
          ${'queen'}, ${1}
        )
      `
    }),
  )
}

function sessionIds(outcome: unknown) {
  if (typeof outcome !== 'object' || outcome === null || !('sessions' in outcome)) return []
  const sessions: unknown = outcome.sessions
  if (!Array.isArray(sessions)) return []
  return sessions.flatMap((session: unknown) =>
    typeof session === 'object' && session !== null && 'sessionId' in session
      ? [session.sessionId]
      : [],
  )
}

describe('SQLite Session query current project scope', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-current-project-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  async function runtimeWithWorktreeWorker(name: string) {
    const runtime = makeRuntime(path.join(temporaryRoot, `${name}.sqlite`))
    runtimes.push(runtime)
    await addWorktreeWorker(runtime)
    return runtime
  }

  it.each([
    ['the project checkout', '/project-a'],
    ['a managed worktree of it', WORKTREE],
    ['a directory inside that worktree', `${WORKTREE}/src/main`],
  ])('lists every Session of the project from %s', async (_label, workingPath) => {
    const runtime = await runtimeWithWorktreeWorker('list')
    const result = await executeQuery(runtime, { operation: 'list', limit: 10, workingPath })

    expect(sessionIds(result.outcome)).toEqual(['worktree-worker', 'queen', 'worker'])
  })

  it('finds a Worker in another worktree of the project by search', async () => {
    const runtime = await runtimeWithWorktreeWorker('search')
    const result = await executeQuery(runtime, {
      operation: 'search',
      query: 'Worktree reviewer',
      limit: 10,
      mode: 'lexical',
      workingPath: '/project-a',
    })

    expect(sessionIds(result.outcome)).toEqual(['worktree-worker'])
    expect(result.outcome).toMatchObject({ sessions: [{ depth: 1, parentSessionId: 'queen' }] })
  })

  it('shows a Worker the Sessions of its Hive in its project, not the rest', async () => {
    const runtime = await runtimeWithWorktreeWorker('worker-scope')
    const workerAuthority: LocalSessionProfileAuthority = {
      profileId: 'derived',
      profileName: 'Worker',
      capabilities: ['sessions:discover', 'delegations:read'],
      scope: { hiveRootSessionIds: ['queen'] },
      authorizationCeiling: 'yolo',
    }
    const result = await executeQuery(
      runtime,
      { operation: 'list', limit: 10, workingPath: WORKTREE },
      workerAuthority,
    )

    expect(sessionIds(result.outcome)).toEqual(['worktree-worker', 'queen', 'worker'])
  })

  it('lists every Delegation of a parent by default, newest first', async () => {
    const runtime = await runtimeWithWorktreeWorker('delegations')
    const result = await executeQuery(runtime, {
      operation: 'delegations-list',
      limit: 10,
      workingPath: '/project-a',
      parentSessionId: 'queen',
    })

    expect(result.outcome).toMatchObject({
      operation: 'delegations-list',
      delegations: [
        { delegationId: 'delegation-wt', state: 'accepted' },
        { delegationId: 'delegation-worker', state: 'ready_for_review' },
      ],
    })
  })

  it('lists only the direct Workers of parentSessionId', async () => {
    const runtime = await runtimeWithWorktreeWorker('parent')
    const result = await executeQuery(runtime, {
      operation: 'list',
      limit: 10,
      parentSessionId: 'queen',
    })

    expect(sessionIds(result.outcome)).toEqual(['worktree-worker', 'worker'])
  })

  it('reports each Session depth in its Hive in list and read', async () => {
    const runtime = await runtimeWithWorktreeWorker('depth')
    const listed = await executeQuery(runtime, { operation: 'list', limit: 10 })
    const read = await executeQuery(runtime, { operation: 'read', sessionId: 'worker' })

    expect(listed.outcome).toMatchObject({
      sessions: [
        { sessionId: 'worktree-worker', depth: 1 },
        { sessionId: 'queen', depth: 0 },
        { sessionId: 'worker', depth: 1 },
        { sessionId: 'other', depth: 0 },
      ],
    })
    expect(read.outcome).toMatchObject({ session: { sessionId: 'worker', depth: 1 } })
  })
})
