import fs from 'node:fs/promises'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
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
 * A discovered Session's history is its Pi file (ADR 0050). When something outside OpenWaggle
 * deletes the file, as Pi's `/resume` picker can, the Session goes with it: it is never continued
 * in a new file under the same Pi session id, which would bring the deleted session back.
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

async function runOnce(sessionId: string) {
  const { executeAgentRun } = await import('../../../application/agent-run-service')
  const { SessionId } = await import('@shared/types/brand')
  return run(
    executeAgentRun({
      sessionId: SessionId(sessionId),
      runId: 'run-after-delete',
      payload: { text: 'Are you there?', attachments: [] },
      model: FAKE_PROVIDER_MODEL,
      signal: new AbortController().signal,
      onEvent: () => undefined,
    }).pipe(Effect.either),
  )
}

async function exists(file: string) {
  return fs.access(file).then(
    () => true,
    () => false,
  )
}

describe('A discovered Session whose Pi file was deleted outside OpenWaggle', () => {
  it('refuses a Run instead of starting a new transcript under the same Pi session', async () => {
    const { cli, sessionId } = await discoveredSession(fixture)
    await fs.rm(cli.file)

    const result = await runOnce(sessionId)

    const failure = result._tag === 'Left' ? String(result.left) : JSON.stringify(result.right)
    expect(failure).toMatch(/Pi session file was deleted/)
    expect(await exists(cli.file)).toBe(false)
    const siblings = await fs.readdir(path.dirname(cli.file))
    expect(siblings.filter((name) => name.includes(cli.id))).toEqual([])
  })

  it('is removed by the next discovery pass, which announces it as deleted', async () => {
    const { cli, sessionId } = await discoveredSession(fixture)
    await fs.rm(cli.file)
    events.length = 0

    await discover()

    expect(await sessionDetail(sessionId)).toBeNull()
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'session-list-changed', sessionId, change: 'deleted' }),
    )
    expect(await exists(cli.file)).toBe(false)
  })

  it('stays while the folder that holds its file is unavailable, as an unmounted drive is', async () => {
    const { cli, sessionId } = await discoveredSession(fixture)
    const folder = path.dirname(cli.file)
    await fs.rename(folder, `${folder}-away`)

    await discover()

    expect(await sessionDetail(sessionId)).not.toBeNull()
    await fs.rename(`${folder}-away`, folder)
  })
})
