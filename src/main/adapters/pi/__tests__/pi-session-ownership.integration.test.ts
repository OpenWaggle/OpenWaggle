import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  agePiFile,
  continuePiCliSession,
  createPiCliSession,
  discover,
  discoverOne,
  messageTexts,
  openSession,
  registerProjects,
  run,
  sessionDetail,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'

/**
 * A discovered Pi session stays the user's file in the program that made it (ADR 0048): removing
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

/** A session the `pi` CLI wrote in its previous file format, version 2. */
async function writeVersion2PiSession(cwd: string) {
  const directory = path.join(
    fixture.root,
    'pi-agent',
    'sessions',
    `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`,
  )
  await fs.mkdir(directory, { recursive: true })
  const file = path.join(directory, '2025-01-01T00-00-00-000Z_old-format.jsonl')
  const lines = [
    { type: 'session', version: 2, id: 'old-format', timestamp: '2025-01-01T00:00:00.000Z', cwd },
    {
      type: 'message',
      id: 'aaaa0001',
      parentId: null,
      timestamp: '2025-01-01T00:00:01.000Z',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'From an older pi' }],
        timestamp: 1,
      },
    },
  ]
  const content = `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`
  await fs.writeFile(file, content)
  agePiFile(file)
  return { file, content }
}

describe('Discovered Pi session ownership', () => {
  it('shows a file in an older Pi format without rewriting it', async () => {
    await registerProjects([fixture.project])
    const old = await writeVersion2PiSession(fixture.project)
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

  it("lists a removed project's Pi sessions again when the folder is added back", async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Back again')
    const sessionId = await discoverOne()
    await openSession(sessionId)
    const { deleteSessionForProjectRemoval } = await import(
      '../../../application/pi-session-project-removal'
    )
    const { SessionProjectionRepository } = await import(
      '../../../ports/session-projection-repository'
    )

    await run(
      deleteSessionForProjectRemoval(
        sessionId,
        Effect.flatMap(SessionProjectionRepository, (repository) => repository.delete(sessionId)),
      ),
    )

    expect(existsSync(cli.file)).toBe(true)
    // The project is still listed until its removal finishes; discovery leaves it alone meanwhile.
    expect(await discover()).toEqual([])
    await registerProjects([])
    expect(await discover()).toEqual([])
    await registerProjects([fixture.project])
    const listedAgain = await discoverOne()
    expect((await sessionDetail(listedAgain))?.piSessionFile).toBe(cli.file)
  })
})
