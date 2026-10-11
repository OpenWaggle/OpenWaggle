import { existsSync, rmSync } from 'node:fs'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { createSession, sendMessage } from './pi-session-created.test-support'
import { run, sessionDetail, setUpPiDiscoveryFixture } from './pi-session-discovery.test-support'
import { FAKE_PROVIDER_MODEL, setUpFakePiProvider } from './pi-session-fake-provider.test-support'

/**
 * Reading a Session OpenWaggle created never writes its Pi file: one never run stays unwritten,
 * so `pi --resume` does not list an empty session. A created Session whose file was deleted says
 * so when it is opened, since its next message starts a new transcript.
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
setUpFakePiProvider(fixture)

async function recordedFile(sessionId: string) {
  const file = (await sessionDetail(sessionId))?.piSessionFile
  if (!file) throw new Error('The Session recorded no Pi file.')
  return file
}

async function opened(sessionId: SessionId) {
  const { dispatchHostBackedSessionGuiOperation } = await import(
    '../../../application/host-ui-session-operation-dispatcher'
  )
  return run(dispatchHostBackedSessionGuiOperation('sessions:get-detail', [sessionId]))
}

describe('A Session OpenWaggle created', () => {
  it('is read for its context usage without writing a Pi file it never ran', async () => {
    const sessionId = await createSession(fixture)
    const file = await recordedFile(sessionId)
    const { getAgentContextUsage } = await import('../../../application/agent-session-service')

    await run(getAgentContextUsage({ sessionId, model: FAKE_PROVIDER_MODEL }))

    expect(existsSync(file)).toBe(false)
    expect((await opened(sessionId))?.piSessionFileDeleted).toBeUndefined()
  })

  it('cannot be forked once its Pi file was deleted, and the fork writes no file back', async () => {
    const sessionId = await createSession(fixture)
    expect((await sendMessage(sessionId, 'First', 'run-first')).outcome).toBe('success')
    const file = await recordedFile(sessionId)
    const lastNode = (await sessionDetail(sessionId))?.messages.at(-1)?.id
    rmSync(file)
    const { forkSession } = await import(
      '../../../application/host-ui-session-lifecycle-operations'
    )

    const fork = await run(
      forkSession([sessionId, FAKE_PROVIDER_MODEL, String(lastNode)], 'at').pipe(Effect.either),
    )

    // There is no file to fork from, which it says, rather than an entry it could not find.
    const cause = fork._tag === 'Left' && fork.left instanceof Error ? fork.left.cause : undefined
    expect(String(cause)).toMatch(/This Session's Pi session file was deleted outside OpenWaggle/)
    expect(existsSync(file)).toBe(false)
  })

  it('says, when opened, that its next message starts a new transcript once its file was deleted', async () => {
    const sessionId = await createSession(fixture)
    expect((await sendMessage(sessionId, 'First', 'run-first')).outcome).toBe('success')
    const file = await recordedFile(sessionId)
    rmSync(file)

    const detail = await opened(sessionId)

    expect(detail?.piSessionFileDeleted).toBe(
      "This Session's Pi file was deleted; the next message starts a new transcript.",
    )
    // The next Run starts the new transcript, so the notice goes.
    expect((await sendMessage(sessionId, 'Second', 'run-second')).outcome).toBe('success')
    expect((await opened(sessionId))?.piSessionFileDeleted).toBeUndefined()
  })
})
