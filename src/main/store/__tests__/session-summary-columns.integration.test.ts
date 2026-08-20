import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession } from '../session-details'
import { setSessionWorktree } from '../session-details/session-mutations'
import { listSessions } from '../sessions/session-list'
import { SESSION_SUMMARY_COLUMN_NAMES } from '../sessions/types'

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
})
