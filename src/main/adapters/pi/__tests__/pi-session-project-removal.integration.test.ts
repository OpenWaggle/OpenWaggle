import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  createPiCliSession,
  discover,
  discoverOne,
  openSession,
  registerProjects,
  run,
  runSql,
  sessionDetail,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'

/**
 * Removing a project deletes its Sessions but keeps a discovered Pi session's file listable, so
 * it comes back when the folder is added again (ADR 0051), whatever step a crash interrupts.
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

describe('Removing a project with discovered Pi sessions', () => {
  it("lists a removed project's Pi sessions again when the folder is added back", async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Back again')
    const sessionId = await discoverOne()
    await openSession(sessionId)
    // Records every dismissal written, so a dismissal undone later still shows.
    await runSql((sql) => sql`CREATE TABLE dismissal_log (pi_session_file TEXT NOT NULL)`)
    await runSql(
      (sql) => sql`
        CREATE TRIGGER log_dismissals AFTER INSERT ON pi_session_dismissals
        BEGIN INSERT INTO dismissal_log VALUES (NEW.pi_session_file); END
      `,
    )
    const { beginPiSessionProjectRemoval, deleteSessionForProjectRemoval } = await import(
      '../../../application/pi-session-project-removal'
    )
    const { SessionProjectionRepository } = await import(
      '../../../ports/session-projection-repository'
    )

    beginPiSessionProjectRemoval(fixture.project)
    await run(
      deleteSessionForProjectRemoval(
        sessionId,
        Effect.flatMap(SessionProjectionRepository, (repository) =>
          repository.delete(sessionId, { removingProject: true }),
        ),
      ),
    )

    expect(existsSync(cli.file)).toBe(true)
    // The deletion never dismissed the file, so no crash during it can leave the file dismissed.
    expect(await runSql((sql) => sql`SELECT pi_session_file FROM dismissal_log`)).toEqual([])
    // The project is still listed until its removal finishes; discovery leaves it alone meanwhile.
    expect(await discover()).toEqual([])
    await registerProjects([])
    expect(await discover()).toEqual([])
    await registerProjects([fixture.project])
    const listedAgain = await discoverOne()
    expect((await sessionDetail(listedAgain))?.piSessionFile).toBe(cli.file)
  })

  it('keeps the Pi file listable when a project removal deletion is finished after a crash', async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Interrupted removal')
    const sessionId = await discoverOne()
    await openSession(sessionId)
    // Another file of the same Pi session, which deleting an OpenWaggle Session would remove.
    const copy = path.join(path.dirname(cli.file), `2020-01-01T00-00-00-000Z_${cli.id}.jsonl`)
    await fs.copyFile(cli.file, copy)
    // The Host stopped right after journaling the deletion; the next Host finishes it.
    const { prepareSessionDeletion } = await import(
      '../../../store/session-details/session-deletion-journal'
    )
    await prepareSessionDeletion(sessionId, undefined, { removingProject: true })
    const { SessionProjectionRepository } = await import(
      '../../../ports/session-projection-repository'
    )
    await run(
      Effect.flatMap(SessionProjectionRepository, (repository) =>
        repository.recoverPendingDeletions ? repository.recoverPendingDeletions() : Effect.void,
      ),
    )

    expect(await sessionDetail(sessionId)).toBeNull()
    expect(existsSync(cli.file)).toBe(true)
    expect(existsSync(copy)).toBe(true)
    await fs.rm(copy)
    expect((await sessionDetail(await discoverOne()))?.piSessionFile).toBe(cli.file)
  })
})
