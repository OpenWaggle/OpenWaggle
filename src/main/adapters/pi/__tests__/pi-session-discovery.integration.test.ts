import path from 'node:path'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  createPiCliSession,
  discover,
  discoverOne,
  registerProjects,
  run,
  sessionDetail,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'

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
})
