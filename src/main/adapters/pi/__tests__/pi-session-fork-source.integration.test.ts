import fs from 'node:fs/promises'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  run,
  runSql,
  sessionDetail,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'
import {
  discoveredSession,
  FAKE_PROVIDER_MODEL,
  setUpFakePiProvider,
} from './pi-session-fake-provider.test-support'

/**
 * A fork of a discovered Pi session is branched from a copy that never writes its source
 * (ADR 0050). The fork is written next to the file the copy loaded, whatever the Session records,
 * and extensions see each file as what it is.
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

async function selectFakeModel() {
  const { SettingsService } = await import('../../../services/settings-service')
  await run(
    Effect.flatMap(SettingsService, (settings) =>
      settings.update({ enabledModels: [FAKE_PROVIDER_MODEL], selectedModel: FAKE_PROVIDER_MODEL }),
    ),
  )
}

async function forkAtLastNode(sessionId: string) {
  const lastNode = (await sessionDetail(sessionId))?.messages.at(-1)?.id
  const { forkSession } = await import('../../../application/host-ui-session-lifecycle-operations')
  return run(forkSession([sessionId, FAKE_PROVIDER_MODEL, String(lastNode)], 'at'))
}

async function recordPiSessionFile(sessionId: string, file: string | null) {
  await runSql((sql) => sql`UPDATE sessions SET pi_session_file = ${file} WHERE id = ${sessionId}`)
}

describe('Forking a discovered Pi session', () => {
  it.each([
    ['records no Pi file', () => null],
    [
      'records a path that no longer exists',
      (source: string) => path.join(path.dirname(source), '..', 'moved', path.basename(source)),
    ],
  ])('writes the fork next to the file it found when the Session %s', async (_, recorded) => {
    await selectFakeModel()
    const { cli, sessionId } = await discoveredSession(fixture)
    const before = await fs.readFile(cli.file, 'utf8')
    await recordPiSessionFile(sessionId, recorded(cli.file))

    const fork = await forkAtLastNode(sessionId)

    // The source is found by its Pi session id and never written.
    expect(await fs.readFile(cli.file, 'utf8')).toBe(before)
    const forkFile = fork.session.piSessionFile
    if (!forkFile) throw new Error('The fork has no Pi file.')
    expect(forkFile).not.toBe(cli.file)
    expect(path.dirname(forkFile)).toBe(path.dirname(cli.file))
    const [header] = (await fs.readFile(forkFile, 'utf8')).split('\n')
    expect(JSON.parse(String(header))).toMatchObject({ type: 'session', parentSession: cli.file })
  })

  it("shows extensions the source before the fork and the fork's own file after it", async () => {
    await selectFakeModel()
    const probe = path.join(fixture.root, 'fork-events.log')
    const extensions = path.join(fixture.project, '.pi', 'extensions')
    await fs.mkdir(extensions, { recursive: true })
    await fs.writeFile(
      path.join(extensions, 'fork-probe.ts'),
      [
        "import { appendFileSync } from 'node:fs'",
        'type Context = { sessionManager: { getSessionFile: () => string | undefined; getSessionId: () => string } }',
        'type Handler = (event: { reason?: string; previousSessionFile?: string }, ctx: Context) => void',
        'export default function (pi: { on: (event: string, handler: Handler) => void }) {',
        `  const log = (line: string) => appendFileSync(${JSON.stringify(probe)}, line + '\\n')`,
        "  pi.on('session_before_fork', (_event, ctx) => log('before ' + ctx.sessionManager.getSessionFile()))",
        "  pi.on('session_start', (event, ctx) => log(['start', event.reason, event.previousSessionFile, ctx.sessionManager.getSessionFile(), ctx.sessionManager.getSessionId()].join(' ')))",
        '}',
      ].join('\n'),
    )
    const { cli, sessionId } = await discoveredSession(fixture)
    const before = await fs.readFile(cli.file, 'utf8')

    const fork = await forkAtLastNode(sessionId)

    expect(await fs.readFile(cli.file, 'utf8')).toBe(before)
    const forkFile = String(fork.session.piSessionFile)
    const events = (await fs.readFile(probe, 'utf8')).trim().split('\n')
    expect(events).toContain(`before ${cli.file}`)
    expect(events).toContain(`start fork ${cli.file} ${forkFile} ${fork.session.piSessionId}`)
  })

  it("keeps what extensions append at the fork's session start in the fork's file", async () => {
    await selectFakeModel()
    const extensions = path.join(fixture.project, '.pi', 'extensions')
    await fs.mkdir(extensions, { recursive: true })
    await fs.writeFile(
      path.join(extensions, 'fork-append.ts'),
      [
        'type Api = {',
        '  on: (event: string, handler: (event: { reason?: string }) => void) => void',
        '  appendEntry: (customType: string, data?: unknown) => void',
        '}',
        'export default function (pi: Api) {',
        "  pi.on('session_start', (event) => {",
        "    if (event.reason === 'fork') pi.appendEntry('fork-probe', { seen: true })",
        '  })',
        '}',
      ].join('\n'),
    )
    const { cli, sessionId } = await discoveredSession(fixture)
    const before = await fs.readFile(cli.file, 'utf8')

    const fork = await forkAtLastNode(sessionId)

    const forkText = await fs.readFile(String(fork.session.piSessionFile), 'utf8')
    expect(forkText).toContain('"customType":"fork-probe"')
    expect(await fs.readFile(cli.file, 'utf8')).toBe(before)
  })
})
