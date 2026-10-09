import fs from 'node:fs/promises'
import path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import {
  agePiFile,
  createPiCliSession,
  discoverOne,
  registerProjects,
  sessionDetail,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'

/**
 * Pi keeps sessions where its settings say (ADR 0050): `PI_CODING_AGENT_SESSION_DIR`, then the
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

  it('takes a relative sessionDir from the folder pi runs in', async () => {
    await fs.mkdir(path.join(fixture.project, '.pi'), { recursive: true })
    await fs.writeFile(
      path.join(fixture.project, '.pi', 'settings.json'),
      JSON.stringify({ sessionDir: '.pi-sessions' }),
    )
    await registerProjects([fixture.project])
    const sessionDir = path.join(fixture.project, '.pi-sessions')
    const file = createPiCliSessionIn(sessionDir, fixture.project, 'Stored relative to the project')

    const sessionId = await discoverOne()

    expect((await sessionDetail(sessionId))?.piSessionFile).toBe(file)
    expect(path.dirname(String(await newOpenWagglePiSessionFile(fixture.project)))).toBe(sessionDir)
  })

  it("keeps a managed worktree Session's file in the project's relative sessionDir", async () => {
    const worktree = path.join(fixture.root, 'worktrees', 'feature')
    for (const checkout of [fixture.project, worktree]) {
      await fs.mkdir(path.join(checkout, '.pi'), { recursive: true })
      await fs.writeFile(
        path.join(checkout, '.pi', 'settings.json'),
        JSON.stringify({ sessionDir: '.pi/sessions' }),
      )
    }
    const { createSessionManagerForSession } = await import('../agent-kernel/session-manager')
    const session = fromPartial<SessionDetail>({
      id: SessionId('worktree-session'),
      projectPath: fixture.project,
      worktreePath: worktree,
      messages: [],
    })

    const manager = createSessionManagerForSession(session, worktree)

    // The worktree may be deleted; `pi --resume` in the project finds the Session there.
    expect(manager.getSessionDir()).toBe(path.join(fixture.project, '.pi', 'sessions'))
    expect(manager.getCwd()).toBe(worktree)
  })

  it('expands a sessionDir under ~ to the home directory', async () => {
    const home = path.join(fixture.root, 'home')
    vi.stubEnv('HOME', home)
    const agentDir = path.join(fixture.root, 'pi-agent')
    await fs.mkdir(agentDir, { recursive: true })
    await fs.writeFile(
      path.join(agentDir, 'settings.json'),
      JSON.stringify({ sessionDir: '~/pi-sessions' }),
    )
    await registerProjects([fixture.project])
    const sessionDir = path.join(home, 'pi-sessions')
    const file = createPiCliSessionIn(sessionDir, fixture.project, 'Stored under home')

    const sessionId = await discoverOne()

    expect((await sessionDetail(sessionId))?.piSessionFile).toBe(file)
  })

  it("finds a subfolder's sessions in Pi's default folder when the project sets its own", async () => {
    // `pi` reads `.pi/settings.json` only in the folder it runs in, so in packages/core it uses
    // the default directory, not the project's sessionDir.
    await fs.mkdir(path.join(fixture.project, '.pi'), { recursive: true })
    await fs.writeFile(
      path.join(fixture.project, '.pi', 'settings.json'),
      JSON.stringify({ sessionDir: path.join(fixture.root, 'project-sessions') }),
    )
    await registerProjects([fixture.project])
    const cwd = path.join(fixture.project, 'packages', 'core')
    const cli = createPiCliSession(cwd, 'In the default folder')

    const sessionId = await discoverOne()

    expect(await sessionDetail(sessionId)).toMatchObject({
      piSessionFile: cli.file,
      projectPath: fixture.project,
    })
  })

  it('gives a nested project with its own sessionDir the sessions stored there', async () => {
    const nested = path.join(fixture.project, 'packages', 'core')
    const nestedSessions = path.join(fixture.root, 'nested-sessions')
    await fs.mkdir(path.join(nested, '.pi'), { recursive: true })
    await fs.writeFile(
      path.join(nested, '.pi', 'settings.json'),
      JSON.stringify({ sessionDir: nestedSessions }),
    )
    await registerProjects([fixture.project, nested])
    const file = createPiCliSessionIn(nestedSessions, nested, 'Stored by the nested setting')

    const sessionId = await discoverOne()

    expect(await sessionDetail(sessionId)).toMatchObject({
      piSessionFile: file,
      projectPath: nested,
    })
  })
})
