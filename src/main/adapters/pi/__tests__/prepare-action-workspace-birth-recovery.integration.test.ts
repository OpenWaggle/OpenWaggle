import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentKernelRunInput } from '../../../ports/agent-kernel-service'
import type { WorkspacePreparationServiceShape } from '../../../ports/workspace-preparation-service'
import { PROJECT_ACTION_MIGRATION } from '../../../services/project-action-migration'
import { inspectLinkedWorktree } from '../../git/worktree-membership'
import {
  catalog,
  restartedService,
} from '../../project-actions/__tests__/preparation-generation.test-harness'
import { readActionWorkspaceEnvironment } from '../../project-actions/action-workspace-environment'
import { ManagedWorkspacePreparation } from '../../project-actions/managed-workspace-preparation'
import type { PreparationDependencies } from '../../project-actions/preparation-dependencies'
import {
  createPreparationPersistence,
  type PreparationPersistence,
} from '../../project-actions/preparation-persistence'

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
const AWAITING_BIRTH = 'This worktree cannot be checked against its saved preparation'
const workspaceId = 'birth-workspace'

let root = ''
let projectPath = ''
let worktreePath = ''
let database = ''

async function git(cwd: string, ...args: string[]) {
  return (await execFileAsync('git', ['-C', cwd, ...args])).stdout.trim()
}

/**
 * One Host process: its own connection to the Session Host database, with the real strict
 * persistence (exact decoding, revision compare-and-set) and Git's view of the worktree.
 */
function host<T>(
  run: (deps: PreparationDependencies, sql: SqlClient.SqlClient) => Promise<T>,
  wrap: (
    persistence: PreparationPersistence,
    sql: SqlClient.SqlClient,
  ) => PreparationPersistence = (persistence) => persistence,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const deps = fromPartial<PreparationDependencies>({
        catalog: async () => catalog,
        persistence: wrap(createPreparationPersistence(sql), sql),
        inspectLinkedWorktree,
      })
      return yield* Effect.promise(() => run(deps, sql))
    }).pipe(Effect.provide(SqliteClient.layer({ filename: database }))),
  )
}

function scope(workspacePath = worktreePath) {
  return { workspaceId, projectPath, workspacePath }
}

async function storedPreparation() {
  return host(async (deps) => deps.persistence.read(workspaceId))
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'openwaggle-birth-host-loss-')))
  projectPath = join(root, 'project')
  worktreePath = join(root, 'worktree')
  database = join(root, 'host.sqlite')
  await execFileAsync('git', ['init', '-q', projectPath])
  await writeFile(join(projectPath, 'README.md'), 'initial\n')
  await git(projectPath, 'add', 'README.md')
  await git(
    projectPath,
    '-c',
    'user.name=OpenWaggle Test',
    '-c',
    'user.email=test@openwaggle.invalid',
    'commit',
    '-qm',
    'initial',
  )
  await host(async (_deps, sql) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* sql`CREATE TABLE workspace_resources (id TEXT PRIMARY KEY)`
        yield* sql`INSERT INTO workspace_resources VALUES (${workspaceId})`
        for (const statement of PROJECT_ACTION_MIGRATION.statements) yield* sql.unsafe(statement)
      }),
    )
  })
})
afterEach(async () => {
  birth.mockReset()
  await rm(root, { recursive: true, force: true })
})

/**
 * The Host that stopped: it prepared the birth, then `materialize` put a folder at the path (by
 * default `git worktree add`), and it died before the setup dispatch captured that folder. Only
 * the database survives it.
 */
async function hostStopsAfterBirth(
  materialize: () => Promise<unknown> = () =>
    git(projectPath, 'worktree', 'add', '-qb', 'session-branch', worktreePath),
) {
  await host(async (deps) => {
    await new ManagedWorkspacePreparation(deps).prepareBirth(scope(projectPath))
  })
  await materialize()
  const pending = await storedPreparation()
  expect(pending).toMatchObject({
    awaitingWorktreeBirth: true,
    awaitingWorktreeBirthSince: expect.any(Number),
  })
  return pending
}

async function expectRecorded(workspacePath = worktreePath) {
  const stat = await lstat(workspacePath, { bigint: true })
  expect(await storedPreparation()).toMatchObject({
    awaitingWorktreeBirth: false,
    workspaceIdentity: { inode: stat.ino.toString(), birthtime: stat.birthtimeNs.toString() },
  })
  expect(
    await host(async (deps) =>
      new ManagedWorkspacePreparation(deps).inspectWorkspaceGeneration(scope(workspacePath)),
    ),
  ).toEqual({ status: 'current' })
}

describe.skipIf(!recordsBirthTime)('Host loss between git worktree add and capture', () => {
  it('lets the next Project Action run record the worktree and start', async () => {
    await hostStopsAfterBirth()
    await expect(
      host((deps) => readActionWorkspaceEnvironment(restartedService(deps).service, scope())),
    ).resolves.toMatchObject({ OPENWAGGLE_WORKTREE_PATH: worktreePath })
    await expectRecorded()
    expect(await storedPreparation()).not.toHaveProperty('awaitingWorktreeBirthSince')
  })

  it('lets the next agent run record the worktree, run setup, and continue', async () => {
    await hostStopsAfterBirth()
    // The restarted birth finds the existing worktree; this Session's dispatch has nothing left.
    birth.mockResolvedValue(worktreePath)
    const result = await host((deps) =>
      Effect.runPromise(
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
            preparation: fromPartial<WorkspacePreparationServiceShape>(
              restartedService(deps).service,
            ),
          },
        ),
      ),
    )
    expect(result).toEqual({ projectPath, executionPath: worktreePath, preparedEnvironment: {} })
    await expectRecorded()
    // The profile has no Setup action, so the setup gate records it as skipped.
    expect(await storedPreparation()).toMatchObject({ setup: { status: 'skipped' } })
  })

  it.each([
    ['the worktree folder was removed', async () => {}, () => worktreePath],
    ['a plain folder is at the path', () => mkdir(worktreePath), () => worktreePath],
    [
      'a plain folder inside the main checkout is at the path',
      () => mkdir(join(projectPath, 'nested')),
      () => join(projectPath, 'nested'),
    ],
    [
      'git worktree add did not finish',
      async () => {
        await git(projectPath, 'worktree', 'add', '-qb', 'session-branch', worktreePath)
        // Git writes this lock before checking files out and removes it once it has finished.
        const gitDir = await git(worktreePath, 'rev-parse', '--path-format=absolute', '--git-dir')
        await writeFile(join(gitDir, 'locked'), 'initializing')
      },
      () => worktreePath,
    ],
  ] satisfies [string, () => Promise<unknown>, () => string][])(
    'still refuses the run when %s',
    async (_case, materialize, workspacePath) => {
      const pending = await hostStopsAfterBirth(materialize)
      await expect(
        host((deps) =>
          readActionWorkspaceEnvironment(restartedService(deps).service, scope(workspacePath())),
        ),
      ).rejects.toThrow(AWAITING_BIRTH)
      expect(await storedPreparation()).toEqual(pending)
    },
  )

  it('records nothing when another writer changes the preparation first', async () => {
    const pending = await hostStopsAfterBirth()
    // Another writer commits a new revision after each read, before this run's write lands.
    const racing = (persistence: PreparationPersistence, sql: SqlClient.SqlClient) => ({
      ...persistence,
      read: async (id: string) => {
        const state = await persistence.read(id)
        await Effect.runPromise(
          sql`UPDATE workspace_preparation SET revision = revision + 1 WHERE workspace_id = ${id}`,
        )
        return state
      },
    })
    await expect(
      host(
        (deps) => readActionWorkspaceEnvironment(restartedService(deps).service, scope()),
        racing,
      ),
    ).rejects.toThrow('Workspace preparation changed')
    expect(await storedPreparation()).toEqual(pending)
  })
})
