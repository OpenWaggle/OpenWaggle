import { SessionManager } from '@earendil-works/pi-coding-agent'
import { SessionId } from '@shared/types/brand'
import { describe, expect, it, vi } from 'vitest'
import {
  agePiFile,
  createPiCliSession,
  discover,
  discoverOne,
  openSession,
  registerProjects,
  sessionDetail,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'

/**
 * A discovered Session's title follows the Pi session's `/name` (ADR 0048), until the user
 * renames the Session in OpenWaggle.
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

/** The CLI's `/name`. */
function namePiSession(file: string, name: string) {
  SessionManager.open(file).appendSessionInfo(name)
  agePiFile(file)
}

describe('Discovered Session titles', () => {
  it('lists a session under the name it was given after a pass first saw it', async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Named later')
    // Seen while still new: the pass reads its start, then waits for the file to go quiet.
    expect(await discover({ now: Date.now() - 10 * 60_000 })).toEqual([])
    namePiSession(cli.file, 'Named in pi')

    const sessionId = await discoverOne()

    expect((await sessionDetail(sessionId))?.title).toBe('Named in pi')
  })

  it('follows a later /name in the pi CLI', async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Untitled at first')
    const sessionId = await discoverOne()
    await openSession(sessionId)
    namePiSession(cli.file, 'Renamed in pi')

    expect(await openSession(sessionId)).toBe('projected')

    expect((await sessionDetail(sessionId))?.title).toBe('Renamed in pi')
  })

  it('keeps the title the user gave the Session in OpenWaggle', async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Renamed by the user')
    const sessionId = await discoverOne()
    await openSession(sessionId)
    const { updateSessionTitle } = await import('../../../store/session-details/session-mutations')
    await updateSessionTitle(SessionId(sessionId), 'My title')
    namePiSession(cli.file, 'Pi name')

    await openSession(sessionId)

    expect((await sessionDetail(sessionId))?.title).toBe('My title')
  })
})
