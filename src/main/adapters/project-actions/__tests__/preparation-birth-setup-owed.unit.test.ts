import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ActionCatalog } from '@shared/types/action-definitions'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readActionWorkspaceEnvironment } from '../action-workspace-environment'
import { ManagedWorkspacePreparation } from '../managed-workspace-preparation'
import type { PreparationDependencies } from '../preparation-dependencies'
import { catalog, memoryDeps, restartedService } from './preparation-generation.test-harness'

vi.mock('../../../logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

/** Recovery proves a folder is new by its birth time; without one it must refuse. */
const recordsBirthTime = (await fs.lstat(os.tmpdir(), { bigint: true })).birthtimeNs !== 0n

const withSetup: ActionCatalog = {
  ...catalog,
  preparation: [
    {
      source: 'local',
      review: 'enabled',
      definition: {
        id: 'setup',
        profileId: 'default',
        phase: 'setup',
        invocation: { type: 'command', command: 'export READY=yes', directory: '.' },
      },
    },
  ],
}

let root = ''
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-setup-owed-')))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

/**
 * The Host prepared the birth, Git created the folder, and the Host stopped before setup
 * dispatch. A Project Action run then recorded the folder.
 */
async function recordedByProjectActionRun(exitCode = 0) {
  const workspace = {
    workspaceId: 'tracked',
    projectPath: root,
    workspacePath: path.join(root, 'worktree'),
  }
  const { storage, deps: memory } = memoryDeps()
  const execute = vi.fn<PreparationDependencies['execute']>(async () => ({
    exitCode,
    environment: { READY: 'yes' },
  }))
  const deps: PreparationDependencies = {
    ...memory,
    catalog: async () => withSetup,
    execute,
    acquireLiveness: () => () => {},
  }
  await new ManagedWorkspacePreparation(deps).prepareBirth({ ...workspace, workspacePath: root })
  await fs.mkdir(workspace.workspacePath)
  await readActionWorkspaceEnvironment(restartedService(deps).service, workspace)
  return { workspace, storage, deps, execute }
}

describe.skipIf(!recordsBirthTime)('setup owed after a run records a worktree birth', () => {
  it('stays owed across Host starts until setup succeeds, then clears', async () => {
    const { workspace, storage, deps, execute } = await recordedByProjectActionRun()
    expect(storage.get(workspace.workspaceId)).toMatchObject({
      runBirthSetupOwed: true,
      setup: { status: 'idle' },
    })
    // A later agent run, in any Session, reads this from a fresh engine.
    const engine = new ManagedWorkspacePreparation(deps)
    expect(await engine.owesSetupAfterRunBirth(workspace)).toBe(true)
    await engine.requireSetup(workspace)
    expect(execute).toHaveBeenCalledOnce()
    expect(storage.get(workspace.workspaceId)).toMatchObject({
      setup: { status: 'succeeded' },
      environment: { READY: 'yes' },
    })
    expect(storage.get(workspace.workspaceId)).not.toHaveProperty('runBirthSetupOwed')
    expect(await new ManagedWorkspacePreparation(deps).owesSetupAfterRunBirth(workspace)).toBe(
      false,
    )
  })

  it('stays owed after setup fails, so the next agent run gates on it again', async () => {
    const { workspace, storage, deps } = await recordedByProjectActionRun(1)
    const engine = new ManagedWorkspacePreparation(deps)
    await expect(engine.requireSetup(workspace)).rejects.toThrow('Workspace setup is failed')
    expect(storage.get(workspace.workspaceId)).toMatchObject({
      runBirthSetupOwed: true,
      setup: { status: 'failed' },
    })
    expect(await engine.owesSetupAfterRunBirth(workspace)).toBe(true)
  })

  it('clears when setup is skipped, and survives choosing another profile', async () => {
    const { workspace, storage, deps } = await recordedByProjectActionRun()
    const engine = new ManagedWorkspacePreparation(deps)
    const owed = storage.get(workspace.workspaceId)
    if (!owed) throw new Error('missing preparation')
    const selected = await engine.select(workspace, 'default', owed.revision)
    expect(storage.get(workspace.workspaceId)).toMatchObject({ runBirthSetupOwed: true })
    await engine.skip(workspace, 'setup', selected.revision)
    expect(storage.get(workspace.workspaceId)).toMatchObject({ setup: { status: 'skipped' } })
    expect(storage.get(workspace.workspaceId)).not.toHaveProperty('runBirthSetupOwed')
  })

  it('is not owed when setup dispatch records the birth', async () => {
    const workspace = {
      workspaceId: 'tracked',
      projectPath: root,
      workspacePath: path.join(root, 'worktree'),
    }
    const { storage, deps } = memoryDeps()
    const engine = new ManagedWorkspacePreparation(deps)
    await engine.prepareBirth({ ...workspace, workspacePath: root })
    await fs.mkdir(workspace.workspacePath)
    await engine.capture(workspace)
    expect(storage.get(workspace.workspaceId)).not.toHaveProperty('runBirthSetupOwed')
    expect(await engine.owesSetupAfterRunBirth(workspace)).toBe(false)
  })
})
