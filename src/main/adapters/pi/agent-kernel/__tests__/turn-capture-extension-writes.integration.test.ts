import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import path from 'node:path'
import { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore } from '@earendil-works/pi-ai'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A Run that executes no mutating tool may still change files through an extension's event
 * handlers, as a project extension that formats on `agent_end` does. Its turn diff must name them.
 */

const { state, getPathMock } = vi.hoisted(() => ({
  state: { root: '', userDataDir: '' },
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

const { execFileAsync } = await import('../../../git/run-git')
const { createSession } = await import('../../../../store/session-details')
const { getTurnDiffFiles } = await import('../../../../store/turn-checkpoints')
const { captureTurnCheckpoint } = await import('../turn-capture')
const { observeRunWorkspaceMutations } = await import('../run-workspace-mutations')
const { resetAppRuntimeForTests } = await import('../../../../runtime')

async function git(cwd: string, args: readonly string[]) {
  await execFileAsync('git', args, { cwd })
}

async function createRepository() {
  const repo = path.join(state.root, 'repo')
  await lifecycleFs.mkdir(repo)
  await git(repo, ['init'])
  await git(repo, ['config', 'user.name', 'OpenWaggle Test'])
  await git(repo, ['config', 'user.email', 'openwaggle@example.test'])
  await lifecycleFs.writeFile(path.join(repo, 'tracked.txt'), 'before\n')
  await git(repo, ['add', '--all'])
  await git(repo, ['commit', '-m', 'Initial commit'])
  return repo
}

/** An extension file outside the repository that writes `formatted.txt` into it on `agent_end`. */
async function writeFormatOnEndExtension(repo: string) {
  const file = path.join(state.root, 'extensions', 'format-on-end.mjs')
  await lifecycleFs.mkdir(path.dirname(file), { recursive: true })
  await lifecycleFs.writeFile(
    file,
    `import { writeFileSync } from 'node:fs'
export default function formatOnEnd(pi) {
  pi.on('agent_end', () => {
    writeFileSync(${JSON.stringify(path.join(repo, 'formatted.txt'))}, 'formatted\\n')
  })
}
`,
  )
  return file
}

async function createPiSession(repo: string, extensionFile: string) {
  const agentDir = path.join(state.root, 'agent')
  await lifecycleFs.mkdir(agentDir)
  const faux = fauxProvider({ provider: 'capture-provider', models: [{ id: 'capture-model' }] })
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    refreshOnCreate: false,
  })
  modelRuntime.registerNativeProvider(faux.provider)
  await modelRuntime.setRuntimeApiKey(faux.provider.id, 'capture-key')
  faux.setResponses([() => fauxAssistantMessage('It reads the file.')])
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } })
  const resourceLoader = new DefaultResourceLoader({
    cwd: repo,
    agentDir,
    settingsManager,
    additionalExtensionPaths: [extensionFile],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  })
  await resourceLoader.reload()
  expect(resourceLoader.getExtensions().errors).toEqual([])
  const { session } = await createAgentSession({
    cwd: repo,
    agentDir,
    model: faux.getModel(),
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.inMemory(repo),
    settingsManager,
    noTools: 'all',
  })
  await session.bindExtensions({})
  return session
}

beforeEach(async () => {
  state.root = await lifecycleFs.mkdtemp(path.join(lifecycleOs.tmpdir(), 'ow-turn-ext-writes-'))
  state.userDataDir = path.join(state.root, 'user-data')
  await lifecycleFs.mkdir(state.userDataDir)
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  await resetAppRuntimeForTests()
  await lifecycleFs.rm(state.root, { recursive: true, force: true })
})

describe('turn checkpoint of a Run whose extension wrote a file', () => {
  it('names the file the extension wrote, though the Run called no mutating tool', async () => {
    const repo = await createRepository()
    const extensionFile = await writeFormatOnEndExtension(repo)
    const session = await createProjectSession(repo)
    const piSession = await createPiSession(repo, extensionFile)
    try {
      // The previous Run's snapshot, which this Run's diff starts from.
      await captureTurnCheckpoint({
        session,
        projectPath: repo,
        runId: 'run-before',
        startedAt: 1,
        workspaceMayHaveChanged: true,
      })
      const observer = observeRunWorkspaceMutations(piSession, 'What does tracked.txt hold?')
      await piSession.prompt('What does tracked.txt hold?')
      observer.dispose()
      await expect(lifecycleFs.readFile(path.join(repo, 'formatted.txt'), 'utf8')).resolves.toBe(
        'formatted\n',
      )

      await captureTurnCheckpoint({
        session,
        projectPath: repo,
        runId: 'run-extension',
        startedAt: 2,
        workspaceMayHaveChanged: observer.mayHaveChangedWorkspace(),
      })

      const files = await getTurnDiffFiles(SessionId(String(session.id)), 'run-extension')
      expect(files.map((file) => file.path)).toEqual(['formatted.txt'])
    } finally {
      piSession.dispose()
    }
  })
})

function createProjectSession(repo: string) {
  return createSession({
    projectPath: repo,
    piSessionId: 'pi-turn-ext-writes',
    piSessionFile: path.join(state.root, 'pi-turn-ext-writes.jsonl'),
  })
}
