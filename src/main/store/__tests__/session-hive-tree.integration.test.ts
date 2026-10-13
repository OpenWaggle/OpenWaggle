import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession } from '../session-details'
import { listHiveTreeSessionCatalogPage } from '../sessions/session-catalog'
import { runStoreEffect } from '../store-runtime'

const { state, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
}))

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

beforeEach(async () => {
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-hive-tree-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const directory = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(directory, { recursive: true, force: true })
})

async function spawnChild(input: {
  readonly childId: string
  readonly parentId: string
  readonly rootId: string
  readonly depth: number
}) {
  const child = await createSession({
    projectPath: '/repo/hive',
    piSessionId: `pi-${input.childId}`,
  })
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        INSERT INTO session_runs (id, session_id, status, created_at, updated_at)
        VALUES (${`run-${input.childId}`}, ${input.parentId}, ${'completed'}, ${1}, ${1})
      `
      yield* sql`
        INSERT INTO session_spawn_lineage (
          child_session_id, parent_session_id, parent_run_id,
          hive_root_session_id, depth, created_at
        ) VALUES (
          ${child.id}, ${input.parentId}, ${`run-${input.childId}`},
          ${input.rootId}, ${input.depth}, ${1}
        )
      `
    }),
  )
  return child
}

describe('Hive tree catalog', () => {
  it('lists every member under its Queen at any depth, from the Queen or a Worker', async () => {
    const queen = await createSession({ projectPath: '/repo/hive', piSessionId: 'pi-queen' })
    const direct = await spawnChild({
      childId: 'direct',
      parentId: queen.id,
      rootId: queen.id,
      depth: 1,
    })
    // A recursive Worker is still a Worker of the same Hive (ADR 0030).
    const deep = await spawnChild({
      childId: 'deep',
      parentId: direct.id,
      rootId: queen.id,
      depth: 2,
    })
    // An unrelated Hive must never appear in this one's tree.
    const stranger = await createSession({
      projectPath: '/repo/hive',
      piSessionId: 'pi-stranger',
    })
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        // Recency order: deep, then direct, then the Queen.
        yield* sql`UPDATE sessions SET updated_at = 3000 WHERE id = ${deep.id}`
        yield* sql`UPDATE sessions SET updated_at = 2000 WHERE id = ${direct.id}`
        yield* sql`UPDATE sessions SET updated_at = 1000 WHERE id = ${queen.id}`
      }),
    )

    const fromQueen = await listHiveTreeSessionCatalogPage(queen.id, 50)
    expect(fromQueen.root?.id).toBe(queen.id)
    expect(fromQueen.members.map((session) => session.id)).toEqual([deep.id, direct.id])
    expect(fromQueen.nextCursor).toBeUndefined()

    // The same list from a deep Worker, with the Queen as root.
    const fromDeep = await listHiveTreeSessionCatalogPage(deep.id, 50)
    expect(fromDeep.root?.id).toBe(queen.id)
    expect(fromDeep.members.map((session) => session.id)).toEqual([deep.id, direct.id])

    // An independent Session is its own root with no members.
    const own = await listHiveTreeSessionCatalogPage(stranger.id, 50)
    expect(own.root?.id).toBe(stranger.id)
    expect(own.members).toEqual([])

    // The root is hydrated like its members, so it carries its own lineage.
    expect(fromQueen.root?.lineage).toMatchObject({ role: 'queen', directWorkerCount: 1 })

    // Lineage metadata survives hydration, so rows can name their parent.
    expect(fromQueen.members[0]?.lineage).toMatchObject({
      parentSessionId: direct.id,
      hiveRootSessionId: queen.id,
    })
  })

  it('pages members by recency with a resumable cursor', async () => {
    const queen = await createSession({ projectPath: '/repo/hive', piSessionId: 'pi-page-queen' })
    const first = await spawnChild({
      childId: 'page-one',
      parentId: queen.id,
      rootId: queen.id,
      depth: 1,
    })
    const second = await spawnChild({
      childId: 'page-two',
      parentId: queen.id,
      rootId: queen.id,
      depth: 1,
    })
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        // Make the second Worker the newest, so the first page holds it alone.
        yield* sql`UPDATE sessions SET updated_at = 1000 WHERE id = ${first.id}`
        yield* sql`UPDATE sessions SET updated_at = 2000 WHERE id = ${second.id}`
        yield* sql`UPDATE sessions SET updated_at = 500 WHERE id = ${queen.id}`
      }),
    )

    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        // The older Worker, on the second page, needs the user.
        yield* sql`
          INSERT INTO delegation_contracts (
            id, parent_session_id, child_session_id, state,
            current_specification_revision, created_at, updated_at
          ) VALUES (${'contract-first'}, ${queen.id}, ${first.id}, ${'needs_attention'}, ${1}, ${1}, ${1})
        `
      }),
    )

    const page = await listHiveTreeSessionCatalogPage(queen.id, 1)
    expect(page.members.map((session) => session.id)).toEqual([second.id])
    expect(page.nextCursor).toBeDefined()
    // The attention total covers the whole Hive, not just the page that was read.
    expect(page.attentionCount).toBe(1)

    const next = await listHiveTreeSessionCatalogPage(queen.id, 1, page.nextCursor)
    expect(next.members.map((session) => session.id)).toEqual([first.id])
    expect(next.nextCursor).toBeUndefined()
  })
})
