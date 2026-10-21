import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { expect, it, vi } from 'vitest'
import { listRetainedPreparation } from '../../../application/retained-workspace-preparation'
import type { ActionRunWorkspace } from '../../../ports/action-run-service'
import { SessionWorkspaceResourceRepository } from '../../../ports/session-workspace-resource-repository'
import {
  WorkspacePreparationService,
  type WorkspacePreparationServiceShape,
} from '../../../ports/workspace-preparation-service'
import { ManagedWorkspacePreparation } from '../managed-workspace-preparation'
import { memoryDeps } from './preparation-generation.test-harness'

const warn = vi.hoisted(() => vi.fn())
vi.mock('../../../logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn, info: vi.fn(), debug: vi.fn() }),
}))

it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'names the worktree when its folder cannot be read at all',
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-preparation-denied-'))
    const parent = path.join(root, 'locked')
    try {
      const workspacePath = path.join(parent, 'worktree')
      await fs.mkdir(workspacePath, { recursive: true })
      const workspace = { workspaceId: 'tracked', projectPath: root, workspacePath }
      const { deps } = memoryDeps()
      const engine = new ManagedWorkspacePreparation(deps)
      await engine.capture(workspace)
      await fs.chmod(parent, 0o000)
      await expect(engine.inspectWorkspaceGeneration(workspace)).rejects.toThrow(
        `Could not check ${workspacePath} against its saved preparation: EACCES`,
      )
      expect(warn).toHaveBeenCalledWith(
        'Could not check the worktree against its saved preparation',
        {
          workspaceId: workspace.workspaceId,
          workspacePath,
          error: expect.stringContaining('EACCES'),
        },
      )
    } finally {
      await fs.chmod(parent, 0o755).catch(() => {})
      await fs.rm(root, { recursive: true, force: true })
    }
  },
)

it.skipIf(process.platform === 'win32')(
  'reports a worktree behind a looping link as not a folder',
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-preparation-loop-'))
    try {
      const workspacePath = path.join(root, 'loop', 'worktree')
      const workspace = { workspaceId: 'tracked', projectPath: root, workspacePath }
      const { storage, deps } = memoryDeps()
      await fs.mkdir(workspacePath, { recursive: true })
      await new ManagedWorkspacePreparation(deps).capture(workspace)
      const recorded = storage.get(workspace.workspaceId)?.workspaceIdentity
      await fs.rm(path.join(root, 'loop'), { recursive: true })
      await fs.symlink(path.join(root, 'loop'), path.join(root, 'loop'))
      const engine = new ManagedWorkspacePreparation(deps)
      expect(await engine.inspectWorkspaceGeneration(workspace)).toEqual({
        status: 'unreadable',
        workspacePath,
        reason: 'not-a-folder',
        recorded,
      })
      // Settings lists it with the reason instead of failing the whole list on ELOOP.
      const listed = await Effect.runPromise(
        listRetainedPreparation(root).pipe(
          Effect.provideService(
            WorkspacePreparationService,
            fromPartial<WorkspacePreparationServiceShape>({
              read: (scope: ActionRunWorkspace) => Effect.promise(() => engine.read(scope)),
              inspectWorkspaceGeneration: (scope: ActionRunWorkspace) =>
                Effect.promise(() => engine.inspectWorkspaceGeneration(scope)),
            }),
          ),
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
      expect(listed.workspaces).toMatchObject([
        {
          path: workspacePath,
          generationMismatch: true,
          generationMismatchMessage: expect.stringContaining(
            `${workspacePath} is not a plain folder`,
          ),
        },
      ])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  },
)
