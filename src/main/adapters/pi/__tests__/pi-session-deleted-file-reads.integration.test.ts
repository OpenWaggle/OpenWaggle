import fs from 'node:fs/promises'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run, sessionDetail, setUpPiDiscoveryFixture } from './pi-session-discovery.test-support'
import {
  discoveredSession,
  FAKE_PROVIDER_MODEL,
  setUpFakePiProvider,
} from './pi-session-fake-provider.test-support'

/**
 * A discovered Session kept after its Pi file was deleted, because a fork depends on it, stays
 * that way through what opening it does: its reads never write the file back, so it keeps its
 * notice, its Runs stay refused, and `pi --resume` does not list the deleted session again.
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

beforeEach(async () => {
  const { SettingsService } = await import('../../../services/settings-service')
  await run(
    Effect.flatMap(SettingsService, (settings) =>
      settings.update({ enabledModels: [FAKE_PROVIDER_MODEL], selectedModel: FAKE_PROVIDER_MODEL }),
    ),
  )
})

async function opened(sessionId: SessionId) {
  const { dispatchHostBackedSessionGuiOperation } = await import(
    '../../../application/host-ui-session-operation-dispatcher'
  )
  return run(dispatchHostBackedSessionGuiOperation('sessions:get-detail', [sessionId]))
}

/** The files in the deleted file's folder that hold its Pi session. */
async function filesOf(file: string, piSessionId: string) {
  const names = await fs.readdir(path.dirname(file))
  return names.filter((name) => name.includes(piSessionId))
}

describe('A forked discovered Session whose Pi file was deleted', () => {
  it('is opened, read, and sent to without its file coming back', async () => {
    const { cli, sessionId: id } = await discoveredSession(fixture)
    const sessionId = SessionId(id)
    const lastNode = (await sessionDetail(sessionId))?.messages.at(-1)?.id
    const { forkSession } = await import(
      '../../../application/host-ui-session-lifecycle-operations'
    )
    await run(forkSession([sessionId, FAKE_PROVIDER_MODEL, String(lastNode)], 'at'))
    await fs.rm(cli.file)

    // Opened: the notice says why it cannot be continued.
    expect((await opened(sessionId))?.piSessionFileDeleted).toMatch(
      /^This Session's Pi session file was deleted.*fork \S+ still depends on it/,
    )
    // The composer reads its context usage, which writes nothing.
    const { getAgentContextUsage } = await import('../../../application/agent-session-service')
    await run(getAgentContextUsage({ sessionId, model: FAKE_PROVIDER_MODEL }))
    expect(await filesOf(cli.file, cli.id)).toEqual([])
    expect((await opened(sessionId))?.piSessionFileDeleted).toMatch(/still depends on it/)

    // A send is refused with the deleted-file error, and writes nothing either.
    const { executeAgentRun } = await import('../../../application/agent-run-service')
    const sent = await run(
      executeAgentRun({
        sessionId,
        runId: 'run-after-delete',
        payload: { text: 'Are you there?', attachments: [] },
        model: FAKE_PROVIDER_MODEL,
        signal: new AbortController().signal,
        onEvent: () => undefined,
      }),
    )

    // Refused before it reached the agent, with DeletedPiSessionFileError's own message.
    expect(sent).toMatchObject({ outcome: 'error', code: 'pi-session-file-deleted' })
    expect(sent).not.toHaveProperty('transportEmitted')
    expect(sent.outcome === 'error' ? sent.message : '').toMatch(
      /^This Session's Pi session file was deleted outside OpenWaggle .*Restore the file to continue it/,
    )
    expect(await filesOf(cli.file, cli.id)).toEqual([])
    expect((await opened(sessionId))?.piSessionFileDeleted).toMatch(/still depends on it/)
  })
})
