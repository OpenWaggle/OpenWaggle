import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { SessionId, SessionNodeId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession, sendMessage } from './pi-session-created.test-support'
import {
  discover,
  run,
  sessionDetail,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'
import {
  discoveredSession,
  FAKE_PROVIDER_MODEL,
  setUpFakePiProvider,
} from './pi-session-fake-provider.test-support'

/**
 * A Session whose Pi folder is gone, renamed away or on a drive that is not connected, is not
 * continued in a new Pi file under the same id: that would replace its history. Its Runs,
 * compaction, and tree navigation are refused until the folder is back, and nothing recreates the
 * folder. The Session stays.
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

const UNAVAILABLE =
  /^This Session's Pi session file is unavailable .*its folder is missing\. Reconnect or restore it/

async function renameFolderAway(file: string) {
  const folder = path.dirname(file)
  await fs.rename(folder, `${folder}.away`)
  return folder
}

function errorMessageOf(result: Either.Either<unknown, unknown>) {
  if (Either.isRight(result)) return undefined
  return result.left instanceof Error ? result.left.message : String(result.left)
}

async function refusedOperations(sessionId: SessionId) {
  const { compactAgentSession, navigateAgentSessionTree } = await import(
    '../../../application/agent-session-service'
  )
  const firstNode = (await sessionDetail(sessionId))?.messages[0]?.id
  if (!firstNode) throw new Error('The Session has no messages.')
  const sent = await sendMessage(sessionId, 'Are you there?', 'run-folder-away')
  return {
    sent,
    compacted: errorMessageOf(
      await run(Effect.either(compactAgentSession({ sessionId, model: FAKE_PROVIDER_MODEL }))),
    ),
    navigated: errorMessageOf(
      await run(
        Effect.either(
          navigateAgentSessionTree({
            sessionId,
            model: FAKE_PROVIDER_MODEL,
            targetNodeId: SessionNodeId(String(firstNode)),
          }),
        ),
      ),
    ),
  }
}

describe('A Session whose Pi folder is unavailable', () => {
  it('is discovered, kept, and refused for a Run, compaction and navigation', async () => {
    const { cli, sessionId: id } = await discoveredSession(fixture)
    const sessionId = SessionId(id)
    const before = (await sessionDetail(sessionId))?.messages.length
    const folder = await renameFolderAway(cli.file)

    const { sent, compacted, navigated } = await refusedOperations(sessionId)

    expect(sent).toMatchObject({ outcome: 'error', code: 'pi-session-file-deleted' })
    expect(sent.outcome === 'error' ? sent.message : '').toMatch(UNAVAILABLE)
    expect(compacted).toMatch(UNAVAILABLE)
    expect(navigated).toMatch(UNAVAILABLE)
    expect(existsSync(folder)).toBe(false)
    // Kept, with its history, through a discovery pass.
    await discover()
    expect((await sessionDetail(sessionId))?.messages.length).toBe(before)
    const { dispatchHostBackedSessionGuiOperation } = await import(
      '../../../application/host-ui-session-operation-dispatcher'
    )
    const opened = await run(
      dispatchHostBackedSessionGuiOperation('sessions:get-detail', [sessionId]),
    )
    expect(opened?.piSessionFileDeleted).toMatch(UNAVAILABLE)
    expect(existsSync(folder)).toBe(false)
  })

  it('is created in OpenWaggle and refused the same way, never continued in a new file', async () => {
    const sessionId = await createSession(fixture)
    expect((await sendMessage(sessionId, 'First', 'run-first')).outcome).toBe('success')
    const file = (await sessionDetail(sessionId))?.piSessionFile
    if (!file) throw new Error('The Session recorded no Pi file.')
    const before = (await sessionDetail(sessionId))?.messages.length
    const folder = await renameFolderAway(file)

    const { sent, compacted, navigated } = await refusedOperations(sessionId)

    expect(sent).toMatchObject({ outcome: 'error', code: 'pi-session-file-deleted' })
    expect(sent.outcome === 'error' ? sent.message : '').toMatch(UNAVAILABLE)
    expect(compacted).toMatch(UNAVAILABLE)
    expect(navigated).toMatch(UNAVAILABLE)
    expect(existsSync(folder)).toBe(false)
    expect((await sessionDetail(sessionId))?.messages.length).toBe(before)
  })
})
