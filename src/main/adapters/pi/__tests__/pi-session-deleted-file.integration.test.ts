import fs from 'node:fs/promises'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
 * A discovered Session's history is its Pi file (ADR 0051). When something outside OpenWaggle
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

// The deletion path takes the Host's removal fence, which a running Session Host provides.
let releaseEventRuntime: (() => void) | undefined
beforeEach(async () => {
  const { installSessionHostEventRuntime } = await import(
    '../../../session-host/session-host-events'
  )
  const { SessionHostEventHub } = await import('../../../application/session-host-event-hub')
  const { SessionHostLiveness } = await import('../../../application/session-host-liveness')
  releaseEventRuntime = installSessionHostEventRuntime({
    eventHub: new SessionHostEventHub(),
    liveness: new SessionHostLiveness({ idleGracePeriodMs: 60_000, requestShutdown: vi.fn() }),
  })
})
afterEach(() => {
  releaseEventRuntime?.()
  releaseEventRuntime = undefined
})

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

  it('goes through the deletion path, which removes its visualizations', async () => {
    const { cli, sessionId } = await discoveredSession(fixture)
    const visualizations = path.join(state.userDataDir, 'visualizations', sessionId)
    await fs.mkdir(visualizations, { recursive: true })
    await fs.writeFile(path.join(visualizations, 'chart.html'), '<p>chart</p>')
    await fs.rm(cli.file)

    await discover()

    expect(await sessionDetail(sessionId)).toBeNull()
    expect(await exists(visualizations)).toBe(false)
  })

  it('stays, without blocking the others, while a fork depends on it', async () => {
    const { SettingsService } = await import('../../../services/settings-service')
    await run(
      Effect.flatMap(SettingsService, (settings) =>
        settings.update({
          enabledModels: [FAKE_PROVIDER_MODEL],
          selectedModel: FAKE_PROVIDER_MODEL,
        }),
      ),
    )
    const forked = await discoveredSession(fixture)
    const lastNode = (await sessionDetail(forked.sessionId))?.messages.at(-1)?.id
    const { forkSession } = await import(
      '../../../application/host-ui-session-lifecycle-operations'
    )
    await run(forkSession([forked.sessionId, FAKE_PROVIDER_MODEL, String(lastNode)], 'at'))
    const plain = await discoveredSession(fixture, { cwd: path.join(fixture.project, 'other') })
    const forkedContent = await fs.readFile(forked.cli.file)
    await fs.rm(forked.cli.file)
    await fs.rm(plain.cli.file)
    events.length = 0

    await discover()
    await discover()

    expect(await sessionDetail(forked.sessionId)).not.toBeNull()
    expect(await sessionDetail(plain.sessionId)).toBeNull()
    expect(events.filter((event) => event.change === 'deleted')).toEqual([
      expect.objectContaining({ sessionId: plain.sessionId }),
    ])
    // Announced once, so an open view shows its notice without being opened again.
    const keptUpdates = () =>
      events.filter((event) => event.sessionId === forked.sessionId && event.change === 'updated')
    expect(keptUpdates()).toHaveLength(1)
    // Its Run is still refused, with a message that does not promise a removal.
    const refused = await runOnce(forked.sessionId)
    const failure = refused._tag === 'Left' ? String(refused.left) : JSON.stringify(refused.right)
    expect(failure).toMatch(/Pi session file was deleted/)
    expect(failure).not.toMatch(/removes the Session|delete the Session/)
    expect(failure).toMatch(/Restore the file to continue it/)
    expect(failure).toMatch(/fork \S+ still depends on it/)
    // Opened, it says so before any send.
    const { dispatchHostBackedSessionGuiOperation } = await import(
      '../../../application/host-ui-session-operation-dispatcher'
    )
    const opened = await run(
      dispatchHostBackedSessionGuiOperation('sessions:get-detail', [forked.sessionId]),
    )
    expect(opened?.piSessionFileDeleted).toMatch(/^This Session's Pi session file was deleted/)
    expect(opened?.piSessionFileDeleted).toMatch(/fork \S+ still depends on it/)
    // Put back, it is announced again, and opens without the notice.
    await fs.writeFile(forked.cli.file, forkedContent)
    await discover()
    expect(keptUpdates()).toHaveLength(2)
    const restored = await run(
      dispatchHostBackedSessionGuiOperation('sessions:get-detail', [forked.sessionId]),
    )
    expect(restored?.piSessionFileDeleted).toBeUndefined()
  })

  it('is opened without a notice while its file is there', async () => {
    const { sessionId } = await discoveredSession(fixture)
    const { dispatchHostBackedSessionGuiOperation } = await import(
      '../../../application/host-ui-session-operation-dispatcher'
    )

    const opened = await run(
      dispatchHostBackedSessionGuiOperation('sessions:get-detail', [sessionId]),
    )

    expect(opened?.id).toBe(sessionId)
    expect(opened?.piSessionFileDeleted).toBeUndefined()
  })
})
