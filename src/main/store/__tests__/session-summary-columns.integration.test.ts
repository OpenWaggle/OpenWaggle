import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession, setSessionWorktree } from '../session-details'
import {
  listArchivedSessionBranchCatalogPage,
  listHiveSessionCatalogPage,
  listSessionCatalogPage,
} from '../sessions/session-catalog'
import { listSessions } from '../sessions/session-list'
import { SESSION_SUMMARY_COLUMN_NAMES } from '../sessions/types'
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
  state.userDataDir = await lifecycleFs.mkdtemp(
    lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-session-summary-columns-'),
  )
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const tmpDir = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await lifecycleFs.rm(tmpDir, { recursive: true, force: true })
})

const WORKTREE_PATH = '/wt/openwaggle/session-under-test'

/**
 * A SELECT column list is invisible to the type checker. `sql<SessionSummaryRow>` asserts
 * the row shape; it does not verify the query selects those columns. Three queries typed
 * this way once omitted `environment_mode` and `worktree_path`, so every session reported
 * local mode with no worktree, the per-session git indicators were absent, and nothing
 * failed — the mistake was found by opening the app.
 *
 * These tests drive the real SQLite path end to end, so a column missing from the SELECT
 * fails here rather than in the UI.
 */
describe('session summary columns survive the live SQL path', () => {
  it('carries environmentMode and worktreePath through listSessions', async () => {
    const session = await createSession({
      projectPath: '/repo/openwaggle',
      piSessionId: 'pi-worktree',
    })
    await setSessionWorktree(SessionId(String(session.id)), 'worktree', WORKTREE_PATH)

    const sessions = await listSessions()
    const listed = sessions.find((entry) => String(entry.id) === String(session.id))

    expect(listed).toBeDefined()
    expect(listed?.environmentMode).toBe('worktree')
    expect(listed?.worktreePath).toBe(WORKTREE_PATH)
  })

  it('reports local mode and no worktree for an ordinary session', async () => {
    const session = await createSession({
      projectPath: '/repo/openwaggle',
      piSessionId: 'pi-local',
    })

    const sessions = await listSessions()
    const listed = sessions.find((entry) => String(entry.id) === String(session.id))

    expect(listed?.environmentMode).toBe('local')
    expect(listed?.worktreePath).toBeNull()
  })

  /**
   * The shared column list is only a single source if it stays in step with the row type.
   * Reading the interface's own keys keeps this honest: adding a field to
   * `SessionSummaryRow` without adding its column fails here.
   */
  it('lists exactly the columns the row type declares', async () => {
    const typeSource = await lifecycleFs.readFile(
      lifecyclePath.join(process.cwd(), 'src/main/store/sessions/types.ts'),
      'utf8',
    )
    const interfaceBody = typeSource.slice(
      typeSource.indexOf('export interface SessionSummaryRow'),
      typeSource.indexOf('}', typeSource.indexOf('export interface SessionSummaryRow')),
    )
    const declaredColumns = [...interfaceBody.matchAll(/readonly ([a-z_]+):/gu)].map(
      (match) => match[1],
    )

    expect([...SESSION_SUMMARY_COLUMN_NAMES].sort()).toEqual(declaredColumns.sort())
  })

  it('keyset-pages catalogs and Hives above the classic SQLite bind-variable limit', async () => {
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`
          WITH RECURSIVE generated(value) AS (
            SELECT 0 UNION ALL SELECT value + 1 FROM generated WHERE value < 1199
          )
          INSERT INTO sessions (
            id, pi_session_id, project_path, title, archived, created_at, updated_at,
            last_active_node_id, last_active_branch_id, environment_mode
          )
          SELECT printf('catalog-%04d', value), printf('pi-catalog-%04d', value),
            '/repo/catalog', printf('Catalog %04d', value), 0, value, value, NULL, NULL, 'local'
          FROM generated
        `)
        yield* sql.unsafe(`
          INSERT INTO session_branches (
            id, session_id, name, is_main, created_at, updated_at, archived_at
          )
          SELECT 'branch-' || id, id, 'Archived branch', 0, created_at, updated_at, updated_at
          FROM sessions WHERE id LIKE 'catalog-____'
        `)
      }),
    )

    const first = await listSessionCatalogPage(false, 75)
    const second = await listSessionCatalogPage(false, 75, first.nextCursor)
    expect(first.sessions).toHaveLength(75)
    expect(second.sessions).toHaveLength(75)
    expect(new Set([...first.sessions, ...second.sessions].map((session) => session.id)).size).toBe(
      150,
    )

    const archivedBranchesFirst = await listArchivedSessionBranchCatalogPage(75)
    const archivedBranchesSecond = await listArchivedSessionBranchCatalogPage(
      75,
      archivedBranchesFirst.nextCursor,
    )
    expect(archivedBranchesFirst.sessions).toHaveLength(75)
    expect(archivedBranchesSecond.sessions).toHaveLength(75)
    expect(archivedBranchesFirst.sessions[0]?.branches).toHaveLength(1)

    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`
          INSERT INTO sessions (
            id, pi_session_id, project_path, title, archived, created_at, updated_at,
            last_active_node_id, last_active_branch_id, environment_mode
          ) VALUES ('catalog-queen', 'pi-catalog-queen', '/repo/catalog', 'Catalog Queen', 0,
            2000, 2000, NULL, NULL, 'local')
        `)
        yield* sql.unsafe(`
          INSERT INTO session_runs (id, session_id, status, created_at, updated_at)
          VALUES ('catalog-queen-run', 'catalog-queen', 'completed', 2000, 2000)
        `)
        yield* sql.unsafe(`
          INSERT INTO session_spawn_lineage (
            child_session_id, parent_session_id, parent_run_id,
            hive_root_session_id, depth, created_at
          )
          SELECT id, 'catalog-queen', 'catalog-queen-run', 'catalog-queen', 1, updated_at
          FROM sessions WHERE id LIKE 'catalog-____'
        `)
      }),
    )

    const hiveFirst = await listHiveSessionCatalogPage(SessionId('catalog-queen'), 75)
    const hiveSecond = await listHiveSessionCatalogPage(
      SessionId('catalog-queen'),
      75,
      hiveFirst.nextCursor,
    )
    expect(hiveFirst.context.map((session) => session.id)).toContain('catalog-queen')
    expect(hiveFirst.workers).toHaveLength(75)
    expect(hiveSecond.workers).toHaveLength(75)
  })
})
