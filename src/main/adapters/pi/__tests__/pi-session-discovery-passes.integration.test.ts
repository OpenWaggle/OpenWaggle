import path from 'node:path'
import type { SessionHostEventPayload } from '@shared/types/session-host-event'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { DiscoveredSessionCreator } from '../../../application/pi-session-discovery'
import type { AppServices } from '../../../runtime'
import {
  continuePiCliSession,
  createPiCliSession,
  lifecycleCreate,
  registerProjects,
  run,
  runSql,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'

/**
 * One discovery pass (ADR 0051): how many Sessions it lists, how it announces them, and how it
 * stays out of a project whose removal starts while it runs.
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

async function sessionCount() {
  const rows = await runSql(
    (sql) => sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM sessions`,
  )
  return rows[0]?.count
}

/** The Sessions announced as updated or deleted while recording. */
async function recordSessionListChanges() {
  const { installSessionHostEventPublisher } = await import(
    '../../../session-host/session-host-events'
  )
  const updated: string[] = []
  const deleted: string[] = []
  const stop = installSessionHostEventPublisher((payload: SessionHostEventPayload) => {
    if (payload.kind !== 'session-list-changed') return
    if (payload.change === 'updated') updated.push(payload.sessionId)
    if (payload.change === 'deleted') deleted.push(payload.sessionId)
  })
  return { updated, deleted, stop }
}

async function discoverWith(createSession: DiscoveredSessionCreator<AppServices>) {
  const { discoverPiSessions } = await import('../../../application/pi-session-discovery')
  return run(discoverPiSessions({ createSession }))
}

describe('A Pi session discovery pass', () => {
  it('stays out of a project whose removal starts during the pass', async () => {
    await registerProjects([fixture.project])
    createPiCliSession(fixture.project, 'First file')
    createPiCliSession(path.join(fixture.project, 'packages', 'core'), 'Second file')
    const create = await lifecycleCreate()
    const { beginPiSessionProjectRemoval } = await import(
      '../../../application/pi-session-project-removal'
    )
    let creates = 0

    // The removal starts after the pass created the first Session, before it adopted the file.
    const listed = await discoverWith((input) =>
      Effect.gen(function* () {
        creates += 1
        const created = yield* create(input)
        beginPiSessionProjectRemoval(fixture.project)
        return created
      }),
    )

    expect(listed).toEqual([])
    expect(creates).toBe(1)
    expect(await sessionCount()).toBe(0)
  })

  it("keeps a nested project's sessions out of the enclosing project while it is removed", async () => {
    const nested = path.join(fixture.project, 'packages', 'core')
    await registerProjects([fixture.project, nested])
    createPiCliSession(nested, 'Belongs to the nested project')
    const create = await lifecycleCreate()
    const [listed] = await discoverWith(create)
    if (!listed) throw new Error('Discovery listed no Session.')
    const { beginPiSessionProjectRemoval, deleteSessionForProjectRemoval } = await import(
      '../../../application/pi-session-project-removal'
    )
    const { SessionProjectionRepository } = await import(
      '../../../ports/session-projection-repository'
    )

    beginPiSessionProjectRemoval(nested)
    await run(
      deleteSessionForProjectRemoval(
        listed,
        Effect.flatMap(SessionProjectionRepository, (repository) =>
          repository.delete(listed, { removingProject: true }),
        ),
      ),
    )

    // The nested project is still listed while it is removed, so its session is not the
    // enclosing project's yet.
    expect(await discoverWith(create)).toEqual([])
    // Once it is gone, the enclosing project lists the session, as `pi` would.
    await registerProjects([fixture.project])
    const [reassigned] = await discoverWith(create)
    expect(reassigned).toBeDefined()
    const { sessionDetail } = await import('./pi-session-discovery.test-support')
    expect((await sessionDetail(String(reassigned)))?.projectPath).toBe(fixture.project)
  })

  it('announces every Session it lists, so the sidebar reads each adopted title', async () => {
    await registerProjects([fixture.project])
    createPiCliSession(fixture.project, 'Announced first')
    createPiCliSession(fixture.project, 'Announced second')
    const changes = await recordSessionListChanges()

    const listed = await discoverWith(await lifecycleCreate()).finally(changes.stop)

    expect(listed).toHaveLength(2)
    expect(changes.updated).toEqual(expect.arrayContaining(listed.map(String)))
  })

  it('lists at most 100 Sessions per pass and the rest in the next', async () => {
    await registerProjects([fixture.project])
    for (let index = 0; index < 101; index++) {
      createPiCliSession(fixture.project, `Session ${String(index)}`)
    }
    const create = await lifecycleCreate()

    expect(await discoverWith(create)).toHaveLength(100)
    expect(await discoverWith(create)).toHaveLength(1)
    expect(await sessionCount()).toBe(101)
  }, 120_000)

  it('deletes the Session it created when attaching the file fails', async () => {
    await registerProjects([fixture.project])
    createPiCliSession(fixture.project, 'Attach fails')
    const { PiSessionDiscoveryRepository } = await import('../../../ports/pi-session-discovery')
    const { discoverPiSessions } = await import('../../../application/pi-session-discovery')
    const lifecycle = await lifecycleCreate()
    const created: string[] = []
    const createSession: typeof lifecycle = (input) =>
      lifecycle(input).pipe(
        Effect.tap((result) => {
          if (result) created.push(result.sessionId)
        }),
      )
    const changes = await recordSessionListChanges()

    const listed = await run(
      Effect.gen(function* () {
        const repository = yield* PiSessionDiscoveryRepository
        return yield* discoverPiSessions({ createSession }).pipe(
          Effect.provideService(PiSessionDiscoveryRepository, {
            ...repository,
            adoptDiscovered: () => Effect.die(new Error('disk full')),
          }),
        )
      }),
    ).finally(changes.stop)

    expect(listed).toEqual([])
    expect(await sessionCount()).toBe(0)
    // The sidebar drops the "New session" the lifecycle announced.
    expect(created).toHaveLength(1)
    expect(changes.deleted).toEqual(created)
  })

  it('drops the empty Session a Host left behind when it stopped between create and attach', async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Interrupted listing')
    // The Host created the Session for this version of the file, then stopped before attaching it.
    const create = await lifecycleCreate()
    const { discoveredSessionCreateKey } = await import('../../../application/pi-session-discovery')
    const stray = await run(
      create({
        projectPath: fixture.project,
        title: 'Interrupted listing',
        idempotencyKey: discoveredSessionCreateKey({ piSessionId: cli.id, size: 1, updatedAt: 1 }),
      }),
    )
    continuePiCliSession(cli.file, 'Written while the Host was down')
    const { removeUnattachedDiscoveredSessions } = await import(
      '../../../application/pi-session-discovery'
    )
    const changes = await recordSessionListChanges()

    // The next Host start, then its first pass.
    await run(removeUnattachedDiscoveredSessions()).finally(changes.stop)
    const listed = await discoverWith(create)

    expect(changes.deleted).toEqual([String(stray?.sessionId)])
    expect(listed).toHaveLength(1)
    expect(await sessionCount()).toBe(1)
  })
})
