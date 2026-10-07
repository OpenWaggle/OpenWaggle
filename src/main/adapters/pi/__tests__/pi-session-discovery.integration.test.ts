import path from 'node:path'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  createPiCliSession,
  discover,
  discoverOne,
  registerProjects,
  run,
  runSql,
  sessionDetail,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'

async function sessionCount() {
  const rows = await runSql(
    (sql) => sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM sessions`,
  )
  return rows[0]?.count
}

/**
 * Pi session discovery (ADR 0048): a session the `pi` CLI created inside an OpenWaggle project is
 * listed once as a Session of that project, created the way the desktop user creates one.
 */

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

const fixture = setUpPiDiscoveryFixture(state)

describe('Pi session discovery', () => {
  it('lists a Pi CLI session from a folder inside a project once, bound to the project', async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(
      path.join(fixture.project, 'packages', 'core'),
      'Explain the parser',
    )
    createPiCliSession(path.join(fixture.root, 'projects', 'other'), 'Not in a project')

    const sessionId = await discoverOne()
    expect(await discover()).toEqual([])

    const detail = await sessionDetail(sessionId)
    expect(detail).toMatchObject({
      id: sessionId,
      projectPath: fixture.project,
      piSessionId: cli.id,
      piSessionFile: cli.file,
      title: 'Explain the parser',
    })
    expect(detail?.messages).toEqual([])
    // Created like a desktop Session: bound to the project's Workspace, with its own queue.
    const { runStoreEffect } = await import('../../../store/store-runtime')
    const SqlClient = await import('@effect/sql/SqlClient')
    const rows = await runStoreEffect(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql<{ readonly working_path: string; readonly queue_state: string }>`
          SELECT workspaces.working_path, control.queue_state
          FROM session_workspace_bindings AS bindings
          JOIN workspace_resources AS workspaces ON workspaces.id = bindings.workspace_id
          JOIN session_control_states AS control ON control.session_id = bindings.session_id
          WHERE bindings.session_id = ${sessionId}
        `,
      ),
    )
    expect(rows).toEqual([{ working_path: fixture.project, queue_state: 'running' }])
  })

  it('does not list a Pi session OpenWaggle already has, or one it is deleting', async () => {
    await registerProjects([fixture.project])
    const own = createPiCliSession(fixture.project, 'Started in OpenWaggle')
    createPiCliSession(fixture.project, 'Being deleted')
    const { SessionProjectionRepository } = await import(
      '../../../ports/session-projection-repository'
    )
    await run(
      Effect.flatMap(SessionProjectionRepository, (repository) =>
        repository.create({
          projectPath: fixture.project,
          piSessionId: own.id,
          piSessionFile: own.file,
        }),
      ),
    )
    const deletingId = await discoverOne()
    const { prepareSessionDeletion } = await import('../../../store/session-details')
    await prepareSessionDeletion(deletingId)

    // The deleted Session's row is gone before its Pi file is.
    const { runStoreEffect } = await import('../../../store/store-runtime')
    const SqlClient = await import('@effect/sql/SqlClient')
    await runStoreEffect(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql`DELETE FROM sessions WHERE id = ${deletingId}`,
      ),
    )

    expect(await discover()).toEqual([])
  })

  it('waits while a new file is still being written', async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Just written')
    const now = new Date()
    const { utimes } = await import('node:fs/promises')
    await utimes(cli.file, now, now)

    expect(await discover()).toEqual([])
  })

  it('leaves a Pi file to the fork or copy that is still preparing it', async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Fork in preparation')
    await runSql(
      (sql) => sql`
        INSERT INTO session_lifecycle_preparation_attempts (
          attempt_id, session_id, pi_session_file, created_at, updated_at
        ) VALUES (${'attempt-1'}, ${'fork-session'}, ${cli.file}, ${1}, ${1})
      `,
    )

    expect(await discover()).toEqual([])
    expect(await sessionCount()).toBe(0)
  })

  it('removes the Session it created when the file was claimed meanwhile', async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Claimed during listing')
    const { PiSessionDiscoveryRepository } = await import('../../../ports/pi-session-discovery')
    const { discoverPiSessions } = await import('../../../application/pi-session-discovery')
    await runSql(
      (sql) => sql`
        INSERT INTO session_lifecycle_preparation_attempts (
          attempt_id, session_id, pi_session_file, created_at, updated_at
        ) VALUES (${'attempt-2'}, ${'fork-session'}, ${cli.file}, ${1}, ${1})
      `,
    )

    // The scope was read before the fork recorded its file; only adoption sees the claim.
    const listed = await run(
      Effect.gen(function* () {
        const repository = yield* PiSessionDiscoveryRepository
        const scopeBeforeClaim = {
          knownPiSessionIds: new Set<string>(),
          knownPiSessionFiles: new Set<string>(),
          sessionProjectPaths: [],
        }
        return yield* discoverPiSessions().pipe(
          Effect.provideService(PiSessionDiscoveryRepository, {
            ...repository,
            readScope: () => Effect.succeed(scopeBeforeClaim),
          }),
        )
      }),
    )

    expect(listed).toEqual([])
    expect(await sessionCount()).toBe(0)
  })

  it('backs off a file it cannot list without holding up other projects', async () => {
    const broken = path.join(fixture.root, 'projects', 'broken')
    const settings = path.join(broken, '.openwaggle', 'settings.json')
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(path.dirname(settings), { recursive: true })
    await writeFile(settings, '{ not json')
    await registerProjects([broken, fixture.project])
    createPiCliSession(broken, 'Blocked by broken settings')
    createPiCliSession(fixture.project, 'Healthy project')
    const { discoverPiSessions } = await import('../../../application/pi-session-discovery')
    const startedAt = Date.now()

    const first = await run(discoverPiSessions({ now: startedAt }))
    expect(first).toHaveLength(1)
    expect((await sessionDetail(String(first[0])))?.projectPath).toBe(fixture.project)

    await writeFile(settings, '{}')
    // The file is unchanged, so it waits out its back-off before it is tried again.
    expect(await run(discoverPiSessions({ now: startedAt + 1_000 }))).toEqual([])
    const later = await run(discoverPiSessions({ now: startedAt + 10 * 60_000 }))
    expect(later).toHaveLength(1)
    expect((await sessionDetail(String(later[0])))?.projectPath).toBe(broken)
  })
})
