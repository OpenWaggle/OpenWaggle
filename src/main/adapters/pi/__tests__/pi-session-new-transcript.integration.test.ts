import { rmSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createSession, sendMessage } from './pi-session-created.test-support'
import {
  messageTexts,
  sessionDetail,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'
import { setUpFakePiProvider } from './pi-session-fake-provider.test-support'

/**
 * A Session OpenWaggle created whose Pi file was deleted starts a new transcript with its next
 * message, which replaces the one it showed. The Session is announced as changed once that Run
 * is saved, so an open view shows the new transcript alone, as it does after a reload.
 */

const { state, getPathMock, events } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
  events: new Array<{ kind: string; sessionId?: string; change?: string }>(),
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

vi.mock('../../../session-host/session-host-events', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../session-host/session-host-events')>()
  return {
    ...original,
    publishSessionHostEvent: (event: Parameters<typeof original.publishSessionHostEvent>[0]) => {
      events.push(event)
      return original.publishSessionHostEvent(event)
    },
  }
})

const fixture = setUpPiDiscoveryFixture(state)
setUpFakePiProvider(fixture)

describe("A created Session's next message after its Pi file was deleted", () => {
  it('replaces the transcript, and announces the Session so a view shows it alone', async () => {
    const sessionId = await createSession(fixture)
    expect((await sendMessage(sessionId, 'First', 'run-first')).outcome).toBe('success')
    const file = (await sessionDetail(sessionId))?.piSessionFile
    if (!file) throw new Error('The Session recorded no Pi file.')
    rmSync(file)
    events.length = 0

    expect((await sendMessage(sessionId, 'Second', 'run-second')).outcome).toBe('success')

    expect(messageTexts(await sessionDetail(sessionId))).toEqual(['Second', 'Fake reply'])
    expect(
      events.filter((event) => event.sessionId === sessionId && event.change === 'updated'),
    ).not.toEqual([])
  })

  it('is not announced for an ordinary next message', async () => {
    const sessionId = await createSession(fixture)
    expect((await sendMessage(sessionId, 'First', 'run-first')).outcome).toBe('success')
    events.length = 0

    expect((await sendMessage(sessionId, 'Second', 'run-second')).outcome).toBe('success')

    expect(
      events.filter((event) => event.sessionId === sessionId && event.change === 'updated'),
    ).toEqual([])
  })
})
