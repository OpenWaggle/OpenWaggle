import path from 'node:path'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { DiscoveredSessionCreator } from '../../../application/pi-session-discovery'
import type { AppServices } from '../../../runtime'
import {
  createPiCliSession,
  lifecycleCreate,
  registerProjects,
  run,
  runSql,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'

/**
 * One discovery pass (ADR 0048): how many Sessions it lists, how it announces them, and how it
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
    const createSession = await lifecycleCreate()

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
    )

    expect(listed).toEqual([])
    expect(await sessionCount()).toBe(0)
  })
})
