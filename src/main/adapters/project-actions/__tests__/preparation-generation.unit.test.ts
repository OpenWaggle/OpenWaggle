import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { expect, it, vi } from 'vitest'
import { listRetainedPreparation } from '../../../application/retained-workspace-preparation'
import { prepareWorkspaceRemoval } from '../../../application/workspace-cleanup'
import { ActionRunService } from '../../../ports/action-run-service'
import { SessionWorkspaceResourceRepository } from '../../../ports/session-workspace-resource-repository'
import {
  WorkspacePreparationService,
  type WorkspacePreparationServiceShape,
} from '../../../ports/workspace-preparation-service'
import { readActionWorkspaceEnvironment } from '../action-workspace-environment'
import {
  ManagedWorkspacePreparation,
  type PreparationDependencies,
} from '../managed-workspace-preparation'
import type { StoredWorkspacePreparation } from '../preparation-persistence'
import { catalog, memoryDeps, restartedService } from './preparation-generation.test-harness'

const warn = vi.hoisted(() => vi.fn())
vi.mock('../../../logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn, info: vi.fn(), debug: vi.fn() }),
}))

/** The device-number tests need birth times; without them the device is compared by design. */
const recordsBirthTime = (await fs.lstat(os.tmpdir(), { bigint: true })).birthtimeNs !== 0n

it.skipIf(!recordsBirthTime)(
  'keeps a prepared worktree runnable across reboots that renumber the volume back and forth',
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-preparation-reboot-'))
    try {
      const workspacePath = path.join(root, 'worktree')
      await fs.mkdir(workspacePath)
      const workspace = { workspaceId: 'tracked', projectPath: root, workspacePath }
      const { storage, deps } = memoryDeps()
      await new ManagedWorkspacePreparation(deps).capture(workspace)
      const recorded = storage.get(workspace.workspaceId)
      if (!recorded?.workspaceIdentity) throw new Error('missing preparation identity')
      // Observed on 2026-10-20/21: st_dev went 16777230 -> 16777233 -> 16777230 over two reboots,
      // with the same inode and birthtime each time. Each Host start reads the record afresh, and
      // the last start finds the device the folder was captured with again.
      const captured = recorded.workspaceIdentity.device
      for (const device of ['16777230', '16777233', captured]) {
        storage.set(workspace.workspaceId, {
          ...recorded,
          workspaceIdentity: { ...recorded.workspaceIdentity, device },
        })
        const { engine, service } = restartedService(deps)
        expect(await engine.inspectWorkspaceGeneration(workspace)).toEqual({ status: 'current' })
        await expect(readActionWorkspaceEnvironment(service, workspace)).resolves.toMatchObject({
          OPENWAGGLE_WORKTREE_PATH: workspacePath,
        })
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  },
)

it('reports the recorded and observed identity when the folder was replaced', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-preparation-replaced-'))
  try {
    const workspacePath = path.join(root, 'worktree')
    await fs.mkdir(workspacePath)
    const workspace = { workspaceId: 'tracked', projectPath: root, workspacePath }
    const { storage, deps } = memoryDeps()
    await new ManagedWorkspacePreparation(deps).capture(workspace)
    const recorded = storage.get(workspace.workspaceId)?.workspaceIdentity
    await fs.rename(workspacePath, path.join(root, 'old'))
    await fs.mkdir(workspacePath)
    const { engine, service } = restartedService(deps)
    const check = await engine.inspectWorkspaceGeneration(workspace)
    expect(check).toMatchObject({ status: 'replaced', workspacePath, recorded })
    if (check.status !== 'replaced') throw new Error('expected a replaced checkout')
    expect(check.observed.inode).not.toBe(recorded?.inode)
    await expect(readActionWorkspaceEnvironment(service, workspace)).rejects.toThrow(
      `${workspacePath} is a different folder from the one that was prepared`,
    )
    await fs.rm(workspacePath, { recursive: true })
    expect(await engine.inspectWorkspaceGeneration(workspace)).toEqual({
      status: 'unreadable',
      workspacePath,
      reason: 'missing',
      recorded,
    })
    await fs.writeFile(workspacePath, 'not a folder')
    expect(await engine.inspectWorkspaceGeneration(workspace)).toEqual({
      status: 'unreadable',
      workspacePath,
      reason: 'not-a-folder',
      recorded,
    })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

it('pins a durable checkout generation and rejects a replacement at the same path', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-preparation-generation-'))
  try {
    const originalPath = path.join(root, 'worktree')
    await fs.mkdir(originalPath)
    const workspace = { workspaceId: 'tracked', projectPath: root, workspacePath: originalPath }
    const storage = new Map<string, StoredWorkspacePreparation>()
    const deps = fromPartial<PreparationDependencies>({
      catalog: async () => catalog,
      persistence: {
        read: async (id: string) => storage.get(id) ?? null,
        list: async () => [...storage.values()],
        write: async (state: StoredWorkspacePreparation) => {
          storage.set(state.workspaceId, structuredClone(state))
        },
      },
    })
    const engine = new ManagedWorkspacePreparation(deps)
    await engine.capture(workspace)
    expect(await engine.inspectWorkspaceGeneration(workspace)).toEqual({ status: 'current' })
    await fs.rename(originalPath, path.join(root, 'removed-worktree'))
    await fs.mkdir(originalPath)
    const restarted = new ManagedWorkspacePreparation(deps)
    expect(await restarted.inspectWorkspaceGeneration(workspace)).toMatchObject({
      status: 'replaced',
      workspacePath: originalPath,
    })

    const recorded = storage.get(workspace.workspaceId)
    if (!recorded) throw new Error('missing preparation')
    const { workspaceIdentity: _identity, ...legacy } = recorded
    storage.set(workspace.workspaceId, legacy)
    expect(await restarted.inspectWorkspaceGeneration(workspace)).toEqual({
      status: 'unrecorded',
      workspacePath: originalPath,
    })

    const pending = await restarted.prepareBirth({ ...workspace, workspacePath: root })
    // Preparing it again only refreshes the pending birth's time.
    expect((await restarted.prepareBirth({ ...workspace, workspacePath: root })).revision).toBe(
      pending.revision + 1,
    )
    expect(await restarted.inspectWorkspaceGeneration(workspace)).toEqual({
      status: 'awaiting-birth',
      workspacePath: originalPath,
    })
    await restarted.capture(workspace)
    expect(await restarted.inspectWorkspaceGeneration(workspace)).toEqual({ status: 'current' })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

it.skipIf(!recordsBirthTime)(
  'removes and lists a prepared worktree normally after a reboot renumbers the volume',
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-preparation-removal-'))
    try {
      const workspacePath = path.join(root, 'worktree')
      await fs.mkdir(workspacePath)
      const workspace = { workspaceId: 'tracked', projectPath: root, workspacePath }
      const { storage, deps } = memoryDeps()
      await new ManagedWorkspacePreparation(deps).capture(workspace)
      const recorded = storage.get(workspace.workspaceId)
      if (!recorded?.workspaceIdentity) throw new Error('missing preparation identity')
      // A pinned (disabled) cleanup keeps removal and listing on the generation check.
      storage.set(workspace.workspaceId, {
        ...recorded,
        snapshot: {
          ...recorded.snapshot,
          definitions: [
            {
              source: 'local',
              review: 'disabled',
              definition: {
                id: 'cleanup',
                profileId: 'default',
                phase: 'cleanup',
                invocation: { type: 'command', command: 'exit 1', directory: '.' },
              },
            },
          ],
        },
        workspaceIdentity: { ...recorded.workspaceIdentity, device: '999999999' },
      })
      const engine = new ManagedWorkspacePreparation(deps)
      const service: Pick<
        WorkspacePreparationServiceShape,
        'read' | 'inspectWorkspaceGeneration' | 'run'
      > = {
        read: (scope) => Effect.promise(() => engine.read(scope)),
        inspectWorkspaceGeneration: (scope) =>
          Effect.promise(() => engine.inspectWorkspaceGeneration(scope)),
        run: (scope, phase) => Effect.promise(() => engine.run(scope, phase)),
      }
      const preparation = fromPartial<WorkspacePreparationServiceShape>(service)
      const listed = await Effect.runPromise(
        listRetainedPreparation(root).pipe(
          Effect.provideService(WorkspacePreparationService, preparation),
          Effect.provideService(
            SessionWorkspaceResourceRepository,
            fromPartial({
              listManagedWorktreeRemovalCandidates: () =>
                Effect.succeed([
                  { id: workspace.workspaceId, projectPath: root, workingPath: workspacePath },
                ]),
            }),
          ),
        ),
      )
      expect(listed.workspaces).toEqual([])
      const removal = await Effect.runPromise(
        prepareWorkspaceRemoval(workspace, { retryFailed: false }).pipe(
          Effect.provideService(WorkspacePreparationService, preparation),
          Effect.provideService(
            ActionRunService,
            fromPartial({ stopWorkspaceRuns: () => Effect.void }),
          ),
        ),
      )
      // The generation matches despite the new device, so removal proceeds; the disabled cleanup
      // records skipped.
      expect(removal).toBeNull()
      expect(storage.get(workspace.workspaceId)?.cleanup.status).toBe('skipped')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  },
)
