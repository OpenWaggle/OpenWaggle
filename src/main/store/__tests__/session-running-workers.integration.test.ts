import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SqliteHiveAncestryLive } from '../../adapters/sqlite-hive-ancestry'
import { HiveAncestry } from '../../ports/hive-ancestry'
import { createSession } from '../session-details'
import { listSessionCatalogPage, listSessionsByIds } from '../sessions/session-catalog'
import { getSessionTree } from '../sessions/session-tree'
import { runStoreEffect } from '../store-runtime'

const { state } = vi.hoisted(() => ({
  state: { userDataDir: '' },
}))

// Each test keeps its files under its own `userData`.
vi.mock('../../desktop-shell/app-paths', async () => {
  const { fakeAppPaths } = await import('../../test-support/fake-desktop-shell')
  return { appPaths: { ...fakeAppPaths(), userData: () => state.userDataDir } }
})

beforeEach(async () => {
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-running-workers-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const directory = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(directory, { recursive: true, force: true })
})

function insertRun(sessionId: SessionId, runId: string, status: string, updatedAt: number) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        INSERT INTO session_runs (id, session_id, status, created_at, updated_at)
        VALUES (${runId}, ${sessionId}, ${status}, ${updatedAt}, ${updatedAt})
      `
    }),
  )
}

function settleRun(runId: string, status: string, updatedAt: number) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE session_runs SET status = ${status}, updated_at = ${updatedAt} WHERE id = ${runId}
      `
    }),
  )
}

function spawn(input: {
  readonly child: SessionId
  readonly parent: SessionId
  readonly parentRunId: string
  readonly root: SessionId
  readonly depth: number
}) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        INSERT INTO session_spawn_lineage (
          child_session_id, parent_session_id, parent_run_id, hive_root_session_id, depth, created_at
        ) VALUES (
          ${input.child}, ${input.parent}, ${input.parentRunId}, ${input.root}, ${input.depth}, ${1}
        )
      `
    }),
  )
}

async function hive() {
  const queen = await createSession({ projectPath: '/repo/hive', piSessionId: 'pi-queen' })
  const planner = await createSession({ projectPath: '/repo/hive', piSessionId: 'pi-planner' })
  const implementer = await createSession({ projectPath: '/repo/hive', piSessionId: 'pi-impl' })
  const reviewer = await createSession({ projectPath: '/repo/hive', piSessionId: 'pi-reviewer' })
  await insertRun(queen.id, 'run-queen', 'completed', 10)
  await insertRun(planner.id, 'run-planner', 'completed', 50)
  await spawn({
    child: planner.id,
    parent: queen.id,
    parentRunId: 'run-queen',
    root: queen.id,
    depth: 1,
  })
  await spawn({
    child: reviewer.id,
    parent: queen.id,
    parentRunId: 'run-queen',
    root: queen.id,
    depth: 1,
  })
  await spawn({
    child: implementer.id,
    parent: planner.id,
    parentRunId: 'run-planner',
    root: queen.id,
    depth: 2,
  })
  await insertRun(implementer.id, 'run-implementer', 'active', 60)
  await insertRun(reviewer.id, 'run-reviewer', 'failed', 80)
  return { queen, planner, implementer, reviewer }
}

describe('Running Workers on a parent summary (ADR 0065)', () => {
  it('counts live Runs over the whole subtree and the last Run that ended below it', async () => {
    const { queen, planner, implementer, reviewer } = await hive()

    const [queenSummary, plannerSummary, implementerSummary, reviewerSummary] =
      await listSessionsByIds([queen.id, planner.id, implementer.id, reviewer.id])
    // The grandchild runs, so both its parent and the Queen count it; a failed Run still ended.
    expect(queenSummary?.lineage).toMatchObject({
      role: 'queen',
      runningWorkerCount: 1,
      workersLastRunEndedAt: 80,
    })
    expect(plannerSummary?.lineage).toMatchObject({ role: 'worker', runningWorkerCount: 1 })
    expect(plannerSummary?.lineage?.workersLastRunEndedAt).toBeUndefined()
    // A leaf has nothing below it, so it carries neither fact.
    expect(implementerSummary?.lineage?.runningWorkerCount).toBeUndefined()
    expect(reviewerSummary?.lineage?.runningWorkerCount).toBeUndefined()

    await settleRun('run-implementer', 'completed', 100)
    const page = await listSessionCatalogPage(false, 50)
    const byId = new Map(page.sessions.map((session) => [session.id, session]))
    expect(byId.get(queen.id)?.lineage).toMatchObject({
      runningWorkerCount: 0,
      workersLastRunEndedAt: 100,
    })
    expect(byId.get(planner.id)?.lineage).toMatchObject({
      runningWorkerCount: 0,
      workersLastRunEndedAt: 100,
    })
    const tree = await getSessionTree(queen.id)
    expect(tree?.session.lineage).toMatchObject({ runningWorkerCount: 0 })
  })

  it('counts a Worker once however many live Runs it has, and starting as running', async () => {
    const { queen, reviewer } = await hive()
    await insertRun(reviewer.id, 'run-reviewer-next', 'starting', 90)

    const [queenSummary] = await listSessionsByIds([queen.id])
    expect(queenSummary?.lineage?.runningWorkerCount).toBe(2)
  })

  it('reads every Spawn-lineage ancestor, nearest first, for the ancestor refresh', async () => {
    const { queen, planner, implementer } = await hive()
    const ancestorsOf = (sessionId: SessionId) =>
      runStoreEffect(
        Effect.gen(function* () {
          const ancestry = yield* HiveAncestry
          return yield* ancestry.ancestorsOf(sessionId)
        }).pipe(Effect.provide(SqliteHiveAncestryLive)),
      )

    expect(await ancestorsOf(implementer.id)).toEqual([planner.id, queen.id])
    expect(await ancestorsOf(queen.id)).toEqual([])
  })
})
