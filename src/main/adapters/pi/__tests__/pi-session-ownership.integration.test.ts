import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { piEntryNodeIds } from '../agent-kernel/pi-entry-node-ids'
import { projectPiSessionSnapshot } from '../agent-kernel/session-projection'
import { repairForeignSnapshotEntryIds } from '../agent-kernel/snapshot-entry-id-repair'
import {
  continuePiCliSession,
  createPiCliSession,
  discover,
  discoverOne,
  messageTexts,
  openSession,
  registerProjects,
  run,
  runSql,
  sessionDetail,
  setUpPiDiscoveryFixture,
  writeVersion2PiSession,
} from './pi-session-discovery.test-support'

/**
 * A discovered Pi session stays the user's file in the program that made it (ADR 0050): removing
 * it from OpenWaggle keeps the file, and a `pi` CLI fork, which copies its source's entry ids, is
 * projected and continued without colliding with the source's nodes (ADR 0041).
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

/** The durable deletion the sidebar's Delete runs once its Session Host checks pass. */
async function deleteSession(sessionId: SessionId) {
  const { SessionProjectionRepository } = await import(
    '../../../ports/session-projection-repository'
  )
  await run(
    Effect.flatMap(SessionProjectionRepository, (repository) => repository.delete(sessionId)),
  )
}

/** What `pi` leaves behind after `/fork` from a session: a new file with the same entry ids. */
function forkPiCliSession(sourceFile: string, cwd: string) {
  const fork = SessionManager.forkFrom(sourceFile, cwd)
  const file = fork.getSessionFile()
  if (!file) throw new Error('Pi did not create the fork file.')
  return { id: fork.getSessionId(), file }
}

describe('Discovered Pi session ownership', () => {
  it('shows a file in an older Pi format without rewriting it', async () => {
    await registerProjects([fixture.project])
    const old = await writeVersion2PiSession(fixture.root, fixture.project)
    const sessionId = await discoverOne()

    expect(await openSession(sessionId)).toBe('projected')

    expect(messageTexts(await sessionDetail(sessionId))).toEqual(['From an older pi'])
    expect(await fs.readFile(old.file, 'utf8')).toBe(old.content)
  })

  it('keeps the Pi file when the user deletes the discovered Session, and does not list it again', async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Keep my history')
    const sessionId = await discoverOne()
    await openSession(sessionId)

    await deleteSession(sessionId)

    expect(await sessionDetail(sessionId)).toBeNull()
    expect(existsSync(cli.file)).toBe(true)
    expect(await discover()).toEqual([])
  })

  it('still deletes the Pi file of a Session OpenWaggle created', async () => {
    await registerProjects([fixture.project])
    const own = createPiCliSession(fixture.project, 'Created in OpenWaggle')
    const { SessionProjectionRepository } = await import(
      '../../../ports/session-projection-repository'
    )
    const created = await run(
      Effect.flatMap(SessionProjectionRepository, (repository) =>
        repository.create({
          projectPath: fixture.project,
          piSessionId: own.id,
          piSessionFile: own.file,
        }),
      ),
    )

    await deleteSession(created.id)

    expect(existsSync(own.file)).toBe(false)
  })

  it('projects a pi CLI fork next to its source and continues it', async () => {
    await registerProjects([fixture.project])
    const source = createPiCliSession(fixture.project, 'Shared start')
    const sourceSessionId = await discoverOne()
    await openSession(sourceSessionId)
    const fork = forkPiCliSession(source.file, fixture.project)
    continuePiCliSession(fork.file, 'Only in the fork')
    const forkSessionId = await discoverOne()

    expect(await openSession(forkSessionId)).toBe('projected')

    expect(messageTexts(await sessionDetail(sourceSessionId))).toEqual([
      'Shared start',
      'Answer to: Shared start',
    ])
    expect(messageTexts(await sessionDetail(forkSessionId))).toEqual([
      'Shared start',
      'Answer to: Shared start',
      'Only in the fork',
      'Answer to: Only in the fork',
    ])
    // The fork file itself is never rewritten: Pi still finds its own entry ids in it.
    const forkEntryIds = SessionManager.open(fork.file)
      .getEntries()
      .map((entry) => entry.id)
    const sourceEntryIds = SessionManager.open(source.file)
      .getEntries()
      .map((entry) => entry.id)
    expect(forkEntryIds.slice(0, sourceEntryIds.length)).toEqual(sourceEntryIds)

    continuePiCliSession(fork.file, 'Continued in the terminal')
    const { reserveSessionTreeMutation } = await import('../../../application/active-session-runs')
    const { loadSessionForRun } = await import('../../../application/pi-session-projection-refresh')
    const writer = reserveSessionTreeMutation(forkSessionId)
    try {
      const session = await run(loadSessionForRun(forkSessionId))
      expect(messageTexts(session).at(-1)).toBe('Answer to: Continued in the terminal')
      // A Run resumes the position the projection selected, translated back to Pi's entry id.
      expect(session?.resumePosition?.piEntryCount).toBe(forkEntryIds.length + 2)
    } finally {
      writer.release()
    }
  })

  it('never renames the entries of a discovered file whose ids another Session holds (ADR 0049)', async () => {
    await registerProjects([fixture.project])
    const own = createPiCliSession(fixture.project, 'Shared start')
    const { SessionRepository } = await import('../../../ports/session-repository')
    const { SessionProjectionRepository } = await import(
      '../../../ports/session-projection-repository'
    )
    const created = await run(
      Effect.flatMap(SessionProjectionRepository, (repository) =>
        repository.create({
          projectPath: fixture.project,
          piSessionId: own.id,
          piSessionFile: own.file,
        }),
      ),
    )
    const ownManager = SessionManager.open(own.file)
    const ownSnapshot = projectPiSessionSnapshot({ sessionManager: ownManager })
    await run(
      Effect.flatMap(SessionRepository, (repository) =>
        repository.persistSnapshot({
          sessionId: created.id,
          nodes: ownSnapshot.nodes,
          activeNodeId: ownSnapshot.activeNodeId,
          piSessionId: own.id,
          piSessionFile: own.file,
        }),
      ),
    )
    // `pi /fork` copies the source's entry ids, which the OpenWaggle Session already holds.
    const fork = forkPiCliSession(own.file, fixture.project)
    continuePiCliSession(fork.file, 'Only in the fork')
    const forkContent = await fs.readFile(fork.file, 'utf8')
    const ownContent = await fs.readFile(own.file, 'utf8')
    const forkSessionId = await discoverOne()
    expect(await openSession(forkSessionId)).toBe('projected')

    // A later save of the discovered Session, as a Run makes, goes through the collision check.
    const detail = await sessionDetail(forkSessionId)
    if (!detail) throw new Error('expected the discovered Session')
    const forkSnapshot = projectPiSessionSnapshot(
      { sessionManager: SessionManager.open(fork.file) },
      piEntryNodeIds(detail),
    )
    await run(
      Effect.flatMap(SessionRepository, (repository) =>
        repository.persistSnapshot({
          sessionId: detail.id,
          nodes: forkSnapshot.nodes,
          activeNodeId: forkSnapshot.activeNodeId,
          piSessionId: fork.id,
          piSessionFile: fork.file,
        }),
      ),
    )

    expect(await fs.readFile(fork.file, 'utf8')).toBe(forkContent)
    expect(await fs.readFile(own.file, 'utf8')).toBe(ownContent)
    expect(messageTexts(await sessionDetail(forkSessionId)).at(-1)).toBe(
      'Answer to: Only in the fork',
    )
  })

  it('leaves a discovered file alone even if its prefixed node ids were reported as foreign', async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Mine alone')
    const sessionId = await discoverOne()
    await openSession(sessionId)
    const detail = await sessionDetail(sessionId)
    if (!detail) throw new Error('expected the discovered Session')
    const content = await fs.readFile(cli.file, 'utf8')
    const snapshot = projectPiSessionSnapshot(
      { sessionManager: SessionManager.open(cli.file) },
      piEntryNodeIds(detail),
    )

    const repaired = await repairForeignSnapshotEntryIds(
      {
        sessionId: detail.id,
        nodes: snapshot.nodes,
        activeNodeId: snapshot.activeNodeId,
        piSessionId: cli.id,
        piSessionFile: cli.file,
      },
      new Set(snapshot.nodes.map((node) => node.id)),
    )

    // Its node ids carry the Session's prefix, so none is an entry id of the file to rename.
    expect(repaired).toBeNull()
    expect(await fs.readFile(cli.file, 'utf8')).toBe(content)
  })

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

  it('lists the file again after a deletion that did not go ahead', async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Deletion abandoned')
    const sessionId = await discoverOne()
    const { abandonSessionDeletion, prepareSessionDeletion } = await import(
      '../../../store/session-details'
    )
    await prepareSessionDeletion(sessionId)
    await abandonSessionDeletion(sessionId)

    // The Session stayed, so its file must not stay dismissed: once the Session is gone some
    // other way, discovery lists the file again.
    await runSql((sql) => sql`DELETE FROM sessions WHERE id = ${sessionId}`)

    const listedAgain = await discoverOne()
    expect((await sessionDetail(listedAgain))?.piSessionFile).toBe(cli.file)
  })
})
