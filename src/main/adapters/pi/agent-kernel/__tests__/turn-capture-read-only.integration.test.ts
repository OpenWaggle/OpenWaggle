import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { turnCheckpointRef } from '@shared/utils/turn-checkpoint-ref'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { state, getPathMock, gitCalls } = vi.hoisted(() => {
  const calls: string[][] = []
  return {
    state: { userDataDir: '', projectPath: '' },
    getPathMock: vi.fn(() => ''),
    gitCalls: calls,
  }
})

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

vi.mock('../../../git/run-git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../git/run-git')>()
  return {
    ...actual,
    runGit: (...args: Parameters<typeof actual.runGit>) => {
      gitCalls.push([...args[1]])
      return actual.runGit(...args)
    },
  }
})

const { execFileAsync } = await import('../../../git/run-git')
const { createSession } = await import('../../../../store/session-details')
const { getTurnDiffFiles, listTurnCheckpoints } = await import('../../../../store/turn-checkpoints')
const { captureTurnCheckpoint } = await import('../turn-capture')

async function git(args: readonly string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd: state.projectPath })
  return typeof result === 'string' ? result : (result.stdout ?? '')
}

async function createRepository() {
  state.projectPath = await lifecycleFs.mkdtemp(
    path.join(lifecycleOs.tmpdir(), 'ow-turn-capture-skip-'),
  )
  await git(['init'])
  await git(['config', 'user.name', 'OpenWaggle Test'])
  await git(['config', 'user.email', 'openwaggle@example.test'])
  await lifecycleFs.writeFile(path.join(state.projectPath, 'tracked.txt'), 'before\n')
  await git(['add', '--all'])
  await git(['commit', '-m', 'Initial commit'])
  return state.projectPath
}

async function createProjectSession(projectPath: string): Promise<SessionDetail> {
  return createSession({
    projectPath,
    piSessionId: 'pi-turn-capture-skip',
    piSessionFile: path.join(lifecycleOs.tmpdir(), 'pi-turn-capture-skip.jsonl'),
  })
}

function capture(
  session: SessionDetail,
  projectPath: string,
  runId: string,
  workspaceMayHaveChanged: boolean,
) {
  return captureTurnCheckpoint({
    session,
    projectPath,
    runId,
    startedAt: 1_700_000_000_000,
    workspaceMayHaveChanged,
  })
}

/** The git commands that stage and snapshot the worktree; a read-only turn runs none of them. */
function snapshotCommands() {
  return gitCalls.filter(([command]) => command === 'add' || command === 'write-tree')
}

beforeEach(async () => {
  state.userDataDir = await lifecycleFs.mkdtemp(
    path.join(lifecycleOs.tmpdir(), 'ow-turn-capture-skip-data-'),
  )
  gitCalls.length = 0
  const { resetAppRuntimeForTests } = await import('../../../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const { resetAppRuntimeForTests } = await import('../../../../runtime')
  await resetAppRuntimeForTests()
  await lifecycleFs.rm(state.userDataDir, { recursive: true, force: true })
  if (state.projectPath) await lifecycleFs.rm(state.projectPath, { recursive: true, force: true })
  state.projectPath = ''
})

describe('turn checkpoint of a Run that changed no files', () => {
  it('records the row with its start time and runs no worktree snapshot', async () => {
    const repo = await createRepository()
    const session = await createProjectSession(repo)
    // A file the user changed: a snapshot would see it, a read-only turn must not stage it.
    await lifecycleFs.writeFile(path.join(repo, 'tracked.txt'), 'edited by the user\n')

    await capture(session, repo, 'run-read-only', false)

    expect(snapshotCommands()).toEqual([])
    expect(gitCalls).toEqual([])
    const [checkpoint] = await listTurnCheckpoints(SessionId(String(session.id)))
    expect(checkpoint).toMatchObject({
      turnId: 'run-read-only',
      startedAt: 1_700_000_000_000,
      insertions: 0,
      deletions: 0,
    })
  })

  it('still snapshots a Run that may have changed files', async () => {
    const repo = await createRepository()
    const session = await createProjectSession(repo)
    await lifecycleFs.writeFile(path.join(repo, 'agent.txt'), 'written\n')

    await capture(session, repo, 'run-mutating', true)

    expect(snapshotCommands().map(([command]) => command)).toEqual(['add', 'write-tree'])
    const files = await getTurnDiffFiles(SessionId(String(session.id)), 'run-mutating')
    expect(files.map((file) => file.path)).toEqual(['agent.txt'])
  })

  it('keeps the diff base, so the next changing Run shows only its own files', async () => {
    const repo = await createRepository()
    const session = await createProjectSession(repo)
    const sessionId = SessionId(String(session.id))

    await lifecycleFs.writeFile(path.join(repo, 'first.txt'), 'first\n')
    await capture(session, repo, 'run-1', true)
    await capture(session, repo, 'run-2', false)
    await lifecycleFs.writeFile(path.join(repo, 'third.txt'), 'third\n')
    await capture(session, repo, 'run-3', true)

    const third = await getTurnDiffFiles(sessionId, 'run-3')
    expect(third.map((file) => file.path)).toEqual(['third.txt'])
    expect(await getTurnDiffFiles(sessionId, 'run-2')).toEqual([])
  })

  it('anchors the carried snapshot under its own ref, so pruning the earlier turn keeps it', async () => {
    const repo = await createRepository()
    const session = await createProjectSession(repo)
    const sessionId = String(session.id)

    await lifecycleFs.writeFile(path.join(repo, 'first.txt'), 'first\n')
    await capture(session, repo, 'run-1', true)
    await capture(session, repo, 'run-2', false)

    const first = await git(['rev-parse', turnCheckpointRef(sessionId, 'run-1')])
    const carried = await git(['rev-parse', turnCheckpointRef(sessionId, 'run-2')])
    expect(carried.trim()).toBe(first.trim())
  })
})
