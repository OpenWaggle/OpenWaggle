import { execFile } from 'node:child_process'
import { lstat, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentKernelRunInput } from '../../../ports/agent-kernel-service'
import type { WorkspacePreparationServiceShape } from '../../../ports/workspace-preparation-service'
import {
  memoryDeps,
  restartedService,
} from '../../project-actions/__tests__/preparation-generation.test-harness'
import { readActionWorkspaceEnvironment } from '../../project-actions/action-workspace-environment'
import { ManagedWorkspacePreparation } from '../../project-actions/managed-workspace-preparation'

const birth = vi.hoisted(() => vi.fn())
vi.mock('../agent-kernel/session-worktree-birth', () => ({
  ensureSessionWorktreeProjectPath: birth,
}))
vi.mock('../../../logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

import { prepareActionWorkspace } from '../prepare-action-workspace'

const execFileAsync = promisify(execFile)
/** Recovery proves a folder is new by its birth time; without one it must refuse. */
const recordsBirthTime = (await lstat(tmpdir(), { bigint: true })).birthtimeNs !== 0n

let root = ''
let projectPath = ''
let worktreePath = ''
const workspaceId = 'birth-workspace'

async function git(...args: string[]) {
  await execFileAsync('git', ['-C', projectPath, ...args])
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'openwaggle-birth-host-loss-')))
  projectPath = join(root, 'project')
  worktreePath = join(root, 'worktree')
  await execFileAsync('git', ['init', '-q', projectPath])
  await writeFile(join(projectPath, 'README.md'), 'initial\n')
  await git('add', 'README.md')
  await git(
    '-c',
    'user.name=OpenWaggle Test',
    '-c',
    'user.email=test@openwaggle.invalid',
    'commit',
    '-qm',
    'initial',
  )
})
afterEach(async () => {
  birth.mockReset()
  await rm(root, { recursive: true, force: true })
})

/**
 * The Host that stopped: it prepared the birth and ran `git worktree add`, then died before the
 * setup dispatch captured the new folder. Only the persisted preparation survives it.
 */
async function hostStopsAfterWorktreeAdd() {
  const { storage, deps } = memoryDeps()
  await new ManagedWorkspacePreparation(deps).prepareBirth({
    workspaceId,
    projectPath,
    workspacePath: projectPath,
  })
  await git('worktree', 'add', '-qb', 'session-branch', worktreePath)
  expect(storage.get(workspaceId)).toMatchObject({ awaitingWorktreeBirth: true })
  return { storage, deps }
}

async function expectRecorded(
  storage: ReturnType<typeof memoryDeps>['storage'],
  engine: ManagedWorkspacePreparation,
) {
  const stat = await lstat(worktreePath, { bigint: true })
  expect(storage.get(workspaceId)).toMatchObject({
    awaitingWorktreeBirth: false,
    workspaceIdentity: { inode: stat.ino.toString(), birthtime: stat.birthtimeNs.toString() },
  })
  expect(
    await engine.inspectWorkspaceGeneration({
      workspaceId,
      projectPath,
      workspacePath: worktreePath,
    }),
  ).toEqual({ status: 'current' })
}

describe.skipIf(!recordsBirthTime)('Host loss between git worktree add and capture', () => {
  it('lets the next Project Action run record the worktree and start', async () => {
    const { storage, deps } = await hostStopsAfterWorktreeAdd()
    const { engine, service } = restartedService(deps)
    await expect(
      readActionWorkspaceEnvironment(service, {
        workspaceId,
        projectPath,
        workspacePath: worktreePath,
      }),
    ).resolves.toMatchObject({ OPENWAGGLE_WORKTREE_PATH: worktreePath })
    await expectRecorded(storage, engine)
  })

  it('lets the next agent run record the worktree and continue', async () => {
    const { storage, deps } = await hostStopsAfterWorktreeAdd()
    const { engine, service } = restartedService(deps)
    // The restarted birth finds the existing worktree; its setup dispatch has nothing pending.
    birth.mockResolvedValue(worktreePath)
    const result = await Effect.runPromise(
      prepareActionWorkspace(
        fromPartial<AgentKernelRunInput>({
          session: { id: SessionId('session'), projectPath, environmentMode: 'worktree' },
          signal: new AbortController().signal,
        }),
        {
          workspaces: {
            getBound: () =>
              Effect.succeed({
                id: workspaceId,
                projectPath,
                workingPath: worktreePath,
                pending: false,
                kind: 'managed-worktree',
                worktreeBranch: 'session-branch',
              }),
          },
          preparation: fromPartial<WorkspacePreparationServiceShape>(service),
        },
      ),
    )
    expect(result).toEqual({ projectPath, executionPath: worktreePath, preparedEnvironment: {} })
    await expectRecorded(storage, engine)
  })

  it('still refuses the run when the worktree folder was removed', async () => {
    const { storage, deps } = await hostStopsAfterWorktreeAdd()
    await rm(worktreePath, { recursive: true, force: true })
    const pending = storage.get(workspaceId)
    const { service } = restartedService(deps)
    await expect(
      readActionWorkspaceEnvironment(service, {
        workspaceId,
        projectPath,
        workspacePath: worktreePath,
      }),
    ).rejects.toThrow('This worktree cannot be checked against its saved preparation')
    expect(storage.get(workspaceId)).toEqual(pending)
  })
})
