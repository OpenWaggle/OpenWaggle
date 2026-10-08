import fs from 'node:fs/promises'
import { SessionManager } from '@earendil-works/pi-coding-agent'

import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  agePiFile,
  createPiCliSession,
  messageTexts,
  openSession,
  registerProjects,
  run,
  sessionDetail,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'

/**
 * A Session OpenWaggle created and the `pi` CLI continued with `pi --resume` (ADR 0050): Pi's
 * eight-character entry ids can repeat ids another Session holds, which the projection must
 * rename the way a Run's snapshot does (ADR 0049) instead of failing on every open.
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

/** A Session OpenWaggle owns, with its Pi file, projected once. */
async function openWaggleSession(prompt: string) {
  const cli = createPiCliSession(fixture.project, prompt)
  const { SessionProjectionRepository } = await import(
    '../../../ports/session-projection-repository'
  )
  const session = await run(
    Effect.flatMap(SessionProjectionRepository, (repository) =>
      repository.create({
        projectPath: fixture.project,
        piSessionId: cli.id,
        piSessionFile: cli.file,
      }),
    ),
  )
  await openSession(String(session.id))
  return { ...cli, sessionId: session.id }
}

/** `pi --resume` adding a reply whose entry id another Session already holds. */
async function continueWithEntryId(file: string, entryId: string, text: string) {
  const leaf = SessionManager.open(file).getLeafId()
  const entry = {
    type: 'message',
    id: entryId,
    parentId: leaf,
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() },
  }
  await fs.appendFile(file, `${JSON.stringify(entry)}\n`)
  agePiFile(file)
}

describe('A Session OpenWaggle created and pi continued', () => {
  it("projects entries whose ids another Session holds by renaming them in the Session's file", async () => {
    await registerProjects([fixture.project])
    const other = await openWaggleSession('Another Session')
    const [taken] = SessionManager.open(other.file).getEntries()
    if (!taken) throw new Error('The other Session has no entries.')
    const continued = await openWaggleSession('Continued in pi')
    await continueWithEntryId(continued.file, taken.id, 'Added by pi --resume')

    expect(await openSession(String(continued.sessionId))).toBe('projected')

    expect(messageTexts(await sessionDetail(String(continued.sessionId))).at(-1)).toBe(
      'Added by pi --resume',
    )
    expect(SessionManager.open(continued.file).getEntry(taken.id)).toBeUndefined()
    // The other Session keeps its node.
    expect(messageTexts(await sessionDetail(String(other.sessionId)))).toContain('Another Session')
  })
})
