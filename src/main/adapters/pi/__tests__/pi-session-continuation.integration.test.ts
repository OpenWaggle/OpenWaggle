import fs from 'node:fs/promises'
import path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'
import { resolveSessionWorkingPath } from '../agent-kernel/session-manager'
import {
  agePiFile,
  createPiCliSession,
  discoverOne,
  openSession,
  registerProjects,
  sessionDetail,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'

/**
 * A discovered Pi session continues the way `pi --resume` would (ADR 0048): in the folder the CLI
 * ran in, with the model and thinking level the session last used.
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

/** A provider Pi knows from `models.json`, as a `pi` user configures a compatible endpoint. */
async function configurePiProvider(models: readonly string[]) {
  const agentDir = path.join(fixture.root, 'pi-agent')
  await fs.mkdir(agentDir, { recursive: true })
  await fs.writeFile(
    path.join(agentDir, 'models.json'),
    JSON.stringify({
      providers: {
        local: {
          baseUrl: 'http://127.0.0.1:9/v1',
          api: 'openai-completions',
          apiKey: 'local-key',
          models: models.map((id) => ({ id })),
        },
      },
    }),
  )
}

/** The CLI switching model and thinking level in a session, as `/model` and `/thinking` do. */
function switchPiSettings(file: string, modelId: string, thinkingLevel: string) {
  const sessionManager = SessionManager.open(file)
  sessionManager.appendModelChange('local', modelId)
  sessionManager.appendThinkingLevelChange(thinkingLevel)
  agePiFile(file)
}

describe('Continuing a discovered Pi session', () => {
  it('runs in the folder the pi CLI ran in, with its last model and thinking level', async () => {
    await configurePiProvider(['first-model', 'last-model'])
    await registerProjects([fixture.project])
    const cwd = path.join(fixture.project, 'packages', 'core')
    const cli = createPiCliSession(cwd, 'Work in the core package')
    switchPiSettings(cli.file, 'last-model', 'high')
    const sessionId = await discoverOne()

    expect(await openSession(sessionId)).toBe('projected')

    const detail = await sessionDetail(sessionId)
    expect(detail).toMatchObject({
      projectPath: fixture.project,
      executionModel: 'local/last-model',
      executionThinkingLevel: 'high',
    })
    if (!detail) throw new Error('The discovered Session is missing.')
    expect(resolveSessionWorkingPath(detail)).toBe(cwd)
  })

  it('keeps the Session model when the pi session used one OpenWaggle cannot reach', async () => {
    await configurePiProvider(['reachable-model'])
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Unreachable model')
    switchPiSettings(cli.file, 'missing-model', 'low')
    const sessionId = await discoverOne()
    const before = (await sessionDetail(sessionId))?.executionModel

    await openSession(sessionId)

    const detail = await sessionDetail(sessionId)
    expect(detail?.executionModel).toBe(before)
    expect(detail?.executionThinkingLevel).toBe('low')
  })
})
