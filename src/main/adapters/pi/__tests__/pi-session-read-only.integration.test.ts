import fs from 'node:fs/promises'
import path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  discoverOne,
  openSession,
  run,
  sessionDetail,
  setUpPiDiscoveryFixture,
  writeVersion2PiSession,
} from './pi-session-discovery.test-support'
import {
  discoveredSession,
  FAKE_PROVIDER_MODEL,
  setUpFakePiProvider,
} from './pi-session-fake-provider.test-support'

/**
 * Looking at a discovered Pi session never changes it (ADR 0050): reads use an in-memory copy of
 * its Pi file, create no agent session where a projection is enough, and bind no extensions.
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

describe('Reading a discovered Pi session', () => {
  it('reads the context usage of a discovered session without writing its Pi file', async () => {
    const old = await writeVersion2PiSession(fixture.root, fixture.project)
    const sessionId = await discoverOne()
    await openSession(sessionId)
    const { getAgentContextUsage } = await import('../../../application/agent-session-service')

    await run(getAgentContextUsage({ sessionId, model: FAKE_PROVIDER_MODEL }))

    // Opening the file for a Run would migrate it to the current format and record the thinking
    // level, which would also change what `pi --resume` continues with.
    expect(await fs.readFile(old.file, 'utf8')).toBe(old.content)
  })

  it('reads a snapshot that holds only the entries in the Pi file', async () => {
    const { cli, sessionId } = await discoveredSession(fixture)
    const detail = await sessionDetail(sessionId)
    if (!detail) throw new Error('The discovered Session is missing.')
    const { AgentKernelService } = await import('../../../ports/agent-kernel-service')

    const snapshot = await run(
      Effect.flatMap(AgentKernelService, (kernel) =>
        kernel.getSessionSnapshot({ session: detail, model: FAKE_PROVIDER_MODEL }),
      ),
    )

    // Opening a session for a Run records a thinking level the file does not hold.
    const fileEntries = SessionManager.open(cli.file).getEntries()
    expect(snapshot.sessionSnapshot.nodes).toHaveLength(fileEntries.length)
    expect(snapshot.piSessionFile).toBe(cli.file)
  })

  it('runs no extension session lifecycle for a read, only for a Run', async () => {
    const probe = path.join(fixture.root, 'extension-events.log')
    const extensions = path.join(fixture.project, '.pi', 'extensions')
    await fs.mkdir(extensions, { recursive: true })
    await fs.writeFile(
      path.join(extensions, 'lifecycle-probe.ts'),
      [
        "import { appendFileSync } from 'node:fs'",
        'export default function (pi: { on: (event: string, handler: () => void) => void }) {',
        `  pi.on('session_start', () => appendFileSync(${JSON.stringify(probe)}, 'start\\n'))`,
        `  pi.on('session_shutdown', () => appendFileSync(${JSON.stringify(probe)}, 'shutdown\\n'))`,
        '}',
      ].join('\n'),
    )
    const { sessionId } = await discoveredSession(fixture)
    const detail = await sessionDetail(sessionId)
    if (!detail) throw new Error('The discovered Session is missing.')
    const { getAgentContextUsage } = await import('../../../application/agent-session-service')
    const { AgentKernelService } = await import('../../../ports/agent-kernel-service')
    const probeEvents = () => fs.readFile(probe, 'utf8').catch(() => '')

    await run(getAgentContextUsage({ sessionId, model: FAKE_PROVIDER_MODEL }))
    await run(
      Effect.flatMap(AgentKernelService, (kernel) =>
        kernel.getSessionSnapshot({ session: detail, model: FAKE_PROVIDER_MODEL }),
      ),
    )
    expect(await probeEvents()).toBe('')

    // The probe is live: a Run starts and ends its extensions' session.
    const { executeAgentRun } = await import('../../../application/agent-run-service')
    await run(
      executeAgentRun({
        sessionId,
        runId: 'run-probe',
        payload: { text: 'Third question', attachments: [] },
        model: FAKE_PROVIDER_MODEL,
        signal: new AbortController().signal,
        onEvent: () => undefined,
      }),
    )
    expect(await probeEvents()).toContain('start')
  })

  it.each([
    ['a file in the current Pi format', 'current'],
    ['a file in an older Pi format', 'version-2'],
  ] as const)('forks %s into a new file without writing the source', async (_, format) => {
    const { SettingsService } = await import('../../../services/settings-service')
    await run(
      Effect.flatMap(SettingsService, (settings) =>
        settings.update({
          enabledModels: [FAKE_PROVIDER_MODEL],
          selectedModel: FAKE_PROVIDER_MODEL,
        }),
      ),
    )
    const { source, id } = await sourceSession(format)
    const before = await fs.readFile(source, 'utf8')
    const lastNode = (await sessionDetail(id))?.messages.at(-1)?.id
    const { forkSession } = await import(
      '../../../application/host-ui-session-lifecycle-operations'
    )

    const fork = await run(forkSession([id, FAKE_PROVIDER_MODEL, String(lastNode)], 'at'))

    expect(await fs.readFile(source, 'utf8')).toBe(before)
    const forkFile = fork.session.piSessionFile
    if (!forkFile) throw new Error('The fork has no Pi file.')
    expect(forkFile).not.toBe(source)
    expect(path.dirname(forkFile)).toBe(path.dirname(source))
    const [header] = (await fs.readFile(forkFile, 'utf8')).split('\n')
    expect(JSON.parse(String(header))).toMatchObject({ type: 'session', parentSession: source })
  })

  it("forks with the source's file in view of extensions, and leaves its bytes as they were", async () => {
    await selectFakeModel()
    const probe = path.join(fixture.root, 'fork-events.log')
    const extensions = path.join(fixture.project, '.pi', 'extensions')
    await fs.mkdir(extensions, { recursive: true })
    await fs.writeFile(
      path.join(extensions, 'fork-probe.ts'),
      [
        "import { appendFileSync } from 'node:fs'",
        'type Context = { sessionManager: { getSessionFile: () => string | undefined } }',
        'type Handler = (event: { reason?: string; previousSessionFile?: string }, ctx: Context) => void',
        'export default function (pi: { on: (event: string, handler: Handler) => void }) {',
        `  const log = (line: string) => appendFileSync(${JSON.stringify(probe)}, line + '\\n')`,
        "  pi.on('session_before_fork', (_event, ctx) => log('before ' + ctx.sessionManager.getSessionFile()))",
        "  pi.on('session_start', (event) => log('start ' + event.reason + ' ' + event.previousSessionFile))",
        '}',
      ].join('\n'),
    )
    const { source, id } = await sourceSession('current')
    const before = await fs.readFile(source, 'utf8')
    const lastNode = (await sessionDetail(id))?.messages.at(-1)?.id
    const { forkSession } = await import(
      '../../../application/host-ui-session-lifecycle-operations'
    )

    const fork = await run(forkSession([id, FAKE_PROVIDER_MODEL, String(lastNode)], 'at'))

    expect(await fs.readFile(source, 'utf8')).toBe(before)
    expect(fork.session.piSessionFile).not.toBe(source)
    const events = (await fs.readFile(probe, 'utf8')).trim().split('\n')
    expect(events).toContain(`before ${source}`)
    expect(events).toContain(`start fork ${source}`)
  })
})

async function selectFakeModel() {
  const { SettingsService } = await import('../../../services/settings-service')
  await run(
    Effect.flatMap(SettingsService, (settings) =>
      settings.update({ enabledModels: [FAKE_PROVIDER_MODEL], selectedModel: FAKE_PROVIDER_MODEL }),
    ),
  )
}

/** A discovered session, projected, and its Pi file. */
async function sourceSession(format: 'current' | 'version-2') {
  if (format === 'current') {
    const discovered = await discoveredSession(fixture)
    return { source: discovered.cli.file, id: discovered.sessionId }
  }
  const old = await writeVersion2PiSession(fixture.root, fixture.project)
  const id = await discoverOne()
  await openSession(id)
  return { source: old.file, id }
}
