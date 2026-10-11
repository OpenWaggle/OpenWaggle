import { rmSync } from 'node:fs'
import type { WaggleConfig } from '@shared/types/waggle'
import { describe, expect, it, vi } from 'vitest'
import { createSession, sendMessage } from './pi-session-created.test-support'
import {
  messageTexts,
  run,
  sessionDetail,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'
import { FAKE_PROVIDER_MODEL, setUpFakePiProvider } from './pi-session-fake-provider.test-support'

/**
 * A created Session whose Pi file was deleted starts a new transcript with its next Waggle too,
 * which replaces the one it showed. The Session is announced as changed once, when the Waggle Run
 * is saved, so an open view shows the new transcript alone.
 */

const { state, getPathMock, events } = vi.hoisted(() => {
  const published: { kind: string; sessionId?: string; change?: string }[] = []
  return { state: { userDataDir: '' }, getPathMock: vi.fn(() => ''), events: published }
})

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

const WAGGLE: WaggleConfig = {
  mode: 'sequential',
  agents: [
    { label: 'Architect', model: FAKE_PROVIDER_MODEL, roleDescription: 'Designs', color: 'blue' },
    { label: 'Reviewer', model: FAKE_PROVIDER_MODEL, roleDescription: 'Reviews', color: 'amber' },
  ],
  stop: { primary: 'consensus', maxTurnsSafety: 2 },
}

async function sendWaggle(sessionId: Parameters<typeof sendMessage>[0], text: string) {
  const { executeWaggleRun } = await import('../../../application/waggle-run-service')
  return run(
    executeWaggleRun({
      sessionId,
      runId: 'run-waggle',
      payload: { text, attachments: [] },
      model: FAKE_PROVIDER_MODEL,
      config: WAGGLE,
      signal: new AbortController().signal,
      onEvent: () => undefined,
      onTurnEvent: () => undefined,
    }),
  )
}

describe("A created Session's next Waggle after its Pi file was deleted", () => {
  it('replaces the transcript, and announces the Session once so a view shows it alone', async () => {
    const sessionId = await createSession(fixture)
    expect((await sendMessage(sessionId, 'First', 'run-first')).outcome).toBe('success')
    const file = (await sessionDetail(sessionId))?.piSessionFile
    if (!file) throw new Error('The Session recorded no Pi file.')
    rmSync(file)
    events.length = 0

    expect((await sendWaggle(sessionId, 'Debate the design')).outcome).toBe('success')

    const texts = messageTexts(await sessionDetail(sessionId))
    expect(texts).toContain('Debate the design')
    expect(texts).not.toContain('First')
    expect(
      events.filter((event) => event.sessionId === sessionId && event.change === 'updated'),
    ).toHaveLength(1)
  })
})
