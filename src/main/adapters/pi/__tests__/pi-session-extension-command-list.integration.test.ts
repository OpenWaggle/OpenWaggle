import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createSession, sendMessage } from './pi-session-created.test-support'
import { run, setUpPiDiscoveryFixture } from './pi-session-discovery.test-support'
import { FAKE_PROVIDER_MODEL, setUpFakePiProvider } from './pi-session-fake-provider.test-support'

/**
 * The slash menu lists the commands a Session's Pi extensions register: for a Session before and
 * after its first message, and for a New session draft in a project, from the project. Pi's own
 * `/mcp`, from the MCP extension every Run loads, is never one: MCP is managed in Settings > MCP.
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

async function installQaExtension() {
  const extensions = path.join(fixture.root, 'pi-agent', 'extensions')
  await fs.mkdir(extensions, { recursive: true })
  await fs.writeFile(
    path.join(extensions, 'qa.ts'),
    [
      'export default function (pi) {',
      "  pi.registerCommand('qa-hello', { description: 'QA hello', handler: async () => {} })",
      '}',
    ].join('\n'),
  )
}

async function listed(sessionId: string | null, projectPath?: string) {
  const { listHostUiAgentExtensionCommands } = await import(
    '../../../application/host-ui-agent-operation'
  )
  return run(listHostUiAgentExtensionCommands(sessionId, FAKE_PROVIDER_MODEL, projectPath))
}

describe("The slash menu's Pi extension commands", () => {
  it('lists a global extension’s command, and not Pi’s /mcp, for a new Session', async () => {
    await installQaExtension()
    const sessionId = await createSession(fixture)

    const commands = await listed(sessionId)

    expect(commands).toContainEqual({ name: 'qa-hello', description: 'QA hello' })
    expect(commands).not.toContainEqual(expect.objectContaining({ name: 'mcp' }))
  })

  it('lists them once the Session has a transcript, still without /mcp from its Run', async () => {
    await installQaExtension()
    const sessionId = await createSession(fixture)
    expect((await sendMessage(sessionId, 'First', 'run-first')).outcome).toBe('success')

    const commands = await listed(sessionId)

    expect(commands).toContainEqual({ name: 'qa-hello', description: 'QA hello' })
    expect(commands).not.toContainEqual(expect.objectContaining({ name: 'mcp' }))
  })

  it('lists them for a New session draft in the project, before there is a Session', async () => {
    await installQaExtension()

    const commands = await listed(null, fixture.project)

    expect(commands).toContainEqual({ name: 'qa-hello', description: 'QA hello' })
    expect(commands).not.toContainEqual(expect.objectContaining({ name: 'mcp' }))
  })
})
