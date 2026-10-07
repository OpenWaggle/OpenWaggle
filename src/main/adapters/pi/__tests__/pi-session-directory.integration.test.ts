import fs from 'node:fs/promises'
import path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'
import {
  agePiFile,
  discoverOne,
  registerProjects,
  sessionDetail,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'

/**
 * Pi keeps sessions where its settings say (ADR 0048): `PI_CODING_AGENT_SESSION_DIR`, then the
 * `sessionDir` setting of the project or the global Pi settings. OpenWaggle finds `pi` sessions
 * there and stores its own new sessions there too, so `pi --resume` finds them.
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

/** What `pi` writes when its session directory is `sessionDir`. */
function createPiCliSessionIn(sessionDir: string, cwd: string, prompt: string) {
  const sessionManager = SessionManager.create(cwd, sessionDir)
  sessionManager.appendMessage({ role: 'user', content: prompt, timestamp: Date.now() })
  sessionManager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: `Answer to: ${prompt}` }],
    api: 'openai-completions',
    provider: 'test',
    model: 'test-model',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  })
  const file = sessionManager.getSessionFile()
  if (!file) throw new Error('Pi did not create a session file.')
  agePiFile(file)
  return file
}

async function newOpenWagglePiSessionFile(projectPath: string) {
  const { createPiSession } = await import('../agent-kernel/session-runtime')
  return (await createPiSession(projectPath)).piSessionFile
}

describe("Pi's session directory", () => {
  it('follows PI_CODING_AGENT_SESSION_DIR', async () => {
    const sessionDir = path.join(fixture.root, 'env-sessions')
    vi.stubEnv('PI_CODING_AGENT_SESSION_DIR', sessionDir)
    await registerProjects([fixture.project])
    const file = createPiCliSessionIn(sessionDir, fixture.project, 'Stored by the env setting')

    const sessionId = await discoverOne()

    expect((await sessionDetail(sessionId))?.piSessionFile).toBe(file)
    expect(path.dirname(String(await newOpenWagglePiSessionFile(fixture.project)))).toBe(sessionDir)
  })

  it("follows the project's sessionDir setting", async () => {
    const sessionDir = path.join(fixture.root, 'project-sessions')
    await fs.mkdir(path.join(fixture.project, '.pi'), { recursive: true })
    await fs.writeFile(
      path.join(fixture.project, '.pi', 'settings.json'),
      JSON.stringify({ sessionDir }),
    )
    await registerProjects([fixture.project])
    const file = createPiCliSessionIn(sessionDir, fixture.project, 'Stored by the project setting')

    const sessionId = await discoverOne()

    expect((await sessionDetail(sessionId))?.piSessionFile).toBe(file)
    expect(path.dirname(String(await newOpenWagglePiSessionFile(fixture.project)))).toBe(sessionDir)
  })

  it('follows the global sessionDir setting', async () => {
    const sessionDir = path.join(fixture.root, 'global-sessions')
    const agentDir = path.join(fixture.root, 'pi-agent')
    await fs.mkdir(agentDir, { recursive: true })
    await fs.writeFile(path.join(agentDir, 'settings.json'), JSON.stringify({ sessionDir }))
    await registerProjects([fixture.project])
    const file = createPiCliSessionIn(sessionDir, fixture.project, 'Stored by the global setting')

    const sessionId = await discoverOne()

    expect((await sessionDetail(sessionId))?.piSessionFile).toBe(file)
  })
})
