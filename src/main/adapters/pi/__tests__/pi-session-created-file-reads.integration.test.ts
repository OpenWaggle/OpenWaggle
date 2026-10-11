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

/** What a created Session whose Pi file was deleted says, as its notice does. */
const CREATED_FILE_DELETED =
  /^This Session's Pi session file was deleted \(.+\)\. Send a message to start a new transcript/

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

  it.each<['before' | 'at']>([['before'], ['at']])(
    'cannot be forked or cloned (%s) once its Pi file was deleted, and writes no file back',
    async (position) => {
      const sessionId = await createSession(fixture)
      expect((await sendMessage(sessionId, 'First', 'run-first')).outcome).toBe('success')
      const file = await recordedFile(sessionId)
      const lastNode = (await sessionDetail(sessionId))?.messages.at(-1)?.id
      rmSync(file)
      const { forkSession } = await import(
        '../../../application/host-ui-session-lifecycle-operations'
      )

      const fork = await run(
        forkSession([sessionId, FAKE_PROVIDER_MODEL, String(lastNode)], position).pipe(
          Effect.either,
        ),
      )

      // It says what the notice says: a message starts a new transcript, which can then be forked.
      const cause = fork._tag === 'Left' && fork.left instanceof Error ? fork.left.cause : undefined
      const message = cause instanceof Error ? cause.message : ''
      expect(message).toMatch(CREATED_FILE_DELETED)
      expect(message).toMatch(/before forking it\.$/)
      expect(existsSync(file)).toBe(false)
    },
  )

  it('cannot be compacted once its Pi file was deleted, and says why', async () => {
    const sessionId = await createSession(fixture)
    expect((await sendMessage(sessionId, 'First', 'run-first')).outcome).toBe('success')
    const file = await recordedFile(sessionId)
    rmSync(file)
    const { compactAgentSession } = await import('../../../application/agent-session-service')

    const compacted = await run(
      Effect.either(compactAgentSession({ sessionId, model: FAKE_PROVIDER_MODEL })),
    )

    const message =
      compacted._tag === 'Left' && compacted.left instanceof Error ? compacted.left.message : ''
    expect(message).toMatch(CREATED_FILE_DELETED)
    expect(message).toMatch(/before compacting it\.$/)
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
