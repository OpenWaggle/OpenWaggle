import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readActionWorkspaceEnvironment } from '../action-workspace-environment'
import { ManagedWorkspacePreparation } from '../managed-workspace-preparation'
import type { StoredWorkspacePreparation } from '../preparation-persistence'
import { memoryDeps, restartedService } from './preparation-generation.test-harness'

const logger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn() }))
vi.mock('../../../logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: logger.warn, info: logger.info, debug: vi.fn() }),
}))

/** Recovery proves a folder is new by its birth time; without one it must refuse. */
const recordsBirthTime = (await fs.lstat(os.tmpdir(), { bigint: true })).birthtimeNs !== 0n
const NANOSECONDS_PER_MILLISECOND = 1_000_000n
const AWAITING_BIRTH = 'This worktree cannot be checked against its saved preparation'

let root = ''
beforeEach(async () => {
  logger.warn.mockClear()
  logger.info.mockClear()
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-birth-recovery-')))
})
afterEach(async () => {
  await fs.chmod(root, 0o700).catch(() => {})
  await fs.rm(root, { recursive: true, force: true })
})

/**
 * Prepares a birth as the first send does, before `git worktree add`: the Workspace is still
 * pending, so its path is the project checkout.
 */
async function prepareBirth(workspacePath: string) {
  const workspace = { workspaceId: 'tracked', projectPath: root, workspacePath }
  const { storage, deps } = memoryDeps()
  await new ManagedWorkspacePreparation(deps).prepareBirth({ ...workspace, workspacePath: root })
  const pending = storage.get(workspace.workspaceId)
  if (!pending?.awaitingWorktreeBirth) throw new Error('expected a pending birth')
  return { workspace, storage, deps, pending }
}

function birthtimeMs(birthtimeNs: bigint) {
  return Number(birthtimeNs / NANOSECONDS_PER_MILLISECOND)
}

describe.skipIf(!recordsBirthTime)('a worktree born before the Host stopped', () => {
  it('records the folder the Host created but did not capture, and runs in it', async () => {
    const { workspace, storage, deps, pending } = await prepareBirth(path.join(root, 'worktree'))
    // `git worktree add` created the folder; the Host stopped before setup dispatch captured it.
    await fs.mkdir(workspace.workspacePath)
    const { engine, service } = restartedService(deps)

    await expect(readActionWorkspaceEnvironment(service, workspace)).resolves.toMatchObject({
      OPENWAGGLE_WORKTREE_PATH: workspace.workspacePath,
    })
    const stat = await fs.lstat(workspace.workspacePath, { bigint: true })
    const recorded = storage.get(workspace.workspaceId)
    expect(recorded).toMatchObject({
      revision: pending.revision + 1,
      awaitingWorktreeBirth: false,
      workspaceIdentity: {
        device: stat.dev.toString(),
        inode: stat.ino.toString(),
        birthtime: stat.birthtimeNs.toString(),
      },
      setup: { status: 'idle' },
    })
    expect(recorded).not.toHaveProperty('awaitingWorktreeBirthSince')
    expect(await engine.inspectWorkspaceGeneration(workspace)).toEqual({ status: 'current' })
    expect(logger.info).toHaveBeenCalledWith(
      'Recorded a worktree created before its preparation captured it',
      expect.objectContaining({ workspaceId: workspace.workspaceId }),
    )
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('records a recreated worktree the Host created but did not capture', async () => {
    const workspace = {
      workspaceId: 'tracked',
      projectPath: root,
      workspacePath: path.join(root, 'worktree'),
    }
    const { storage, deps } = memoryDeps()
    await fs.mkdir(workspace.workspacePath)
    await new ManagedWorkspacePreparation(deps).capture(workspace)
    const original = storage.get(workspace.workspaceId)?.workspaceIdentity
    // Recreate worktree: the old folder is gone, the preparation is reset, then Git adds a new one.
    await fs.rm(workspace.workspacePath, { recursive: true })
    await new ManagedWorkspacePreparation(deps).prepareBirth({ ...workspace, workspacePath: root })
    expect(storage.get(workspace.workspaceId)).toMatchObject({
      awaitingWorktreeBirth: true,
      awaitingWorktreeBirthSince: expect.any(Number),
    })
    await fs.mkdir(workspace.workspacePath)
    const { engine, service } = restartedService(deps)
    await expect(readActionWorkspaceEnvironment(service, workspace)).resolves.toMatchObject({
      OPENWAGGLE_WORKTREE_PATH: workspace.workspacePath,
    })
    expect(storage.get(workspace.workspaceId)?.workspaceIdentity).not.toEqual(original)
    expect(await engine.inspectWorkspaceGeneration(workspace)).toEqual({ status: 'current' })
  })

  it('keeps failing while the folder is missing', async () => {
    const { workspace, storage, deps, pending } = await prepareBirth(path.join(root, 'worktree'))
    const { service } = restartedService(deps)
    await expect(readActionWorkspaceEnvironment(service, workspace)).rejects.toThrow(AWAITING_BIRTH)
    expect(storage.get(workspace.workspaceId)).toEqual(pending)
  })

  it('keeps failing when something other than a folder is at the path', async () => {
    const { workspace, storage, deps, pending } = await prepareBirth(path.join(root, 'worktree'))
    await fs.writeFile(workspace.workspacePath, 'not a folder')
    const { service } = restartedService(deps)
    await expect(readActionWorkspaceEnvironment(service, workspace)).rejects.toThrow(AWAITING_BIRTH)
    expect(storage.get(workspace.workspaceId)).toEqual(pending)
  })

  it('keeps failing for a folder that predates the birth, such as one moved back in', async () => {
    const { workspace, storage, deps, pending } = await prepareBirth(path.join(root, 'worktree'))
    await fs.mkdir(workspace.workspacePath)
    const born = (await fs.lstat(workspace.workspacePath, { bigint: true })).birthtimeNs
    // The birth was prepared a minute after this folder was made.
    const preparedLater: StoredWorkspacePreparation = {
      ...pending,
      awaitingWorktreeBirthSince: birthtimeMs(born) + 60_000,
    }
    storage.set(workspace.workspaceId, preparedLater)
    const { service } = restartedService(deps)
    await expect(readActionWorkspaceEnvironment(service, workspace)).rejects.toThrow(AWAITING_BIRTH)
    expect(storage.get(workspace.workspaceId)).toEqual(preparedLater)
    expect(logger.warn).toHaveBeenCalledWith(
      'Did not record a pending worktree birth',
      expect.objectContaining({ reason: 'predates-birth', workspacePath: workspace.workspacePath }),
    )
  })

  it('keeps failing for a pending birth saved before its time was recorded', async () => {
    const { workspace, storage, deps, pending } = await prepareBirth(path.join(root, 'worktree'))
    const { awaitingWorktreeBirthSince: _since, ...legacy } = pending
    storage.set(workspace.workspaceId, legacy)
    await fs.mkdir(workspace.workspacePath)
    const { service } = restartedService(deps)
    await expect(readActionWorkspaceEnvironment(service, workspace)).rejects.toThrow(AWAITING_BIRTH)
    expect(storage.get(workspace.workspaceId)).toEqual(legacy)
  })

  it('keeps failing once setup has run against the unrecorded folder', async () => {
    const { workspace, storage, deps, pending } = await prepareBirth(path.join(root, 'worktree'))
    const started: StoredWorkspacePreparation = {
      ...pending,
      setup: { ...pending.setup, status: 'failed' },
    }
    storage.set(workspace.workspaceId, started)
    await fs.mkdir(workspace.workspacePath)
    const { service } = restartedService(deps)
    await expect(readActionWorkspaceEnvironment(service, workspace)).rejects.toThrow(AWAITING_BIRTH)
    expect(storage.get(workspace.workspaceId)).toEqual(started)
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'keeps failing, naming the folder, when it cannot be read',
    async () => {
      const parent = path.join(root, 'locked')
      const { workspace, storage, deps, pending } = await prepareBirth(
        path.join(parent, 'worktree'),
      )
      await fs.mkdir(workspace.workspacePath, { recursive: true })
      await fs.chmod(parent, 0o000)
      try {
        const { service } = restartedService(deps)
        await expect(readActionWorkspaceEnvironment(service, workspace)).rejects.toThrow(
          `${AWAITING_BIRTH}: ${workspace.workspacePath} could not be read (EACCES`,
        )
        expect(storage.get(workspace.workspaceId)).toEqual(pending)
      } finally {
        await fs.chmod(parent, 0o700)
      }
    },
  )
})

it('records when a birth was prepared, and forgets it once the folder is captured', async () => {
  const before = Date.now()
  const { workspace, storage, deps, pending } = await prepareBirth(path.join(root, 'worktree'))
  expect(pending.awaitingWorktreeBirthSince).toBeGreaterThanOrEqual(before)
  expect(pending.awaitingWorktreeBirthSince).toBeLessThanOrEqual(Date.now())
  await fs.mkdir(workspace.workspacePath)
  await new ManagedWorkspacePreparation(deps).capture(workspace)
  expect(storage.get(workspace.workspaceId)).toMatchObject({ awaitingWorktreeBirth: false })
  expect(storage.get(workspace.workspaceId)).not.toHaveProperty('awaitingWorktreeBirthSince')
})
