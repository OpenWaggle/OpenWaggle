import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ActionManagementRequest } from '@shared/types/action-management'
import type { WorkspacePreparation } from '@shared/types/workspace-preparation'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionCatalogService } from '../../ports/action-catalog-service'
import { ActionRunService } from '../../ports/action-run-service'
import { SessionWorkspaceResourceRepository } from '../../ports/session-workspace-resource-repository'
import { WorkspacePreparationService } from '../../ports/workspace-preparation-service'
import { WorkspaceProjectAuthorization } from '../../ports/workspace-project-authorization'
import { manageProjectActions } from '../action-management'

describe('native action management authority', () => {
  let root = ''
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'action-api-')))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function fixture(projectPath = root, pending = false) {
    const start = vi.fn(() => Effect.succeed(fromPartial({ id: 'run' })))
    const read = vi.fn(() =>
      Effect.succeed({ revision: 'one', actions: [], profiles: [], preparation: [] }),
    )
    const getBound = vi.fn(() =>
      Effect.succeed({
        id: 'bound-workspace',
        projectPath,
        kind: 'local' as const,
        workingPath: pending ? join(root, 'future-worktree') : root,
        pending,
        worktreeBranch: null,
      }),
    )
    const preparationRead = vi.fn(() =>
      Effect.succeed(
        fromPartial<WorkspacePreparation>({
          workspaceId: 'retained',
          cleanup: { status: 'failed' },
        }),
      ),
    )
    const listManagedWorktreeRemovalCandidates = () =>
      Effect.succeed([
        { id: 'retained', projectPath: root, workingPath: root },
        { id: 'unrelated', projectPath: tmpdir(), workingPath: root },
      ])
    const run = (request: ActionManagementRequest) =>
      Effect.runPromise(
        manageProjectActions(request).pipe(
          Effect.provideService(WorkspaceProjectAuthorization, {
            authorize: () => Effect.succeed(root),
          }),
          Effect.provideService(
            SessionWorkspaceResourceRepository,
            fromPartial({ getBound, listManagedWorktreeRemovalCandidates }),
          ),
          Effect.provideService(ActionCatalogService, fromPartial({ read })),
          Effect.provideService(ActionRunService, fromPartial({ start })),
          Effect.provideService(
            WorkspacePreparationService,
            fromPartial({ read: preparationRead }),
          ),
        ),
      )
    return { run, start, read, getBound, preparationRead }
  }

  it('restores cleanup failures without a Session while isolating other projects', async () => {
    const test = fixture()
    await expect(
      test.run({ scope: { projectPath: root }, operation: { type: 'retained-preparation' } }),
    ).resolves.toMatchObject({
      type: 'retained-preparation',
      workspaces: [
        { path: root, preparation: { workspaceId: 'retained', cleanup: { status: 'failed' } } },
      ],
    })
    expect(test.preparationRead).toHaveBeenCalledOnce()
    expect(test.preparationRead).toHaveBeenCalledWith({
      workspaceId: 'retained',
      projectPath: root,
      workspacePath: root,
    })
  })

  it('reads project settings without requiring a Session, but cannot run outside a binding', async () => {
    const test = fixture()
    await expect(
      test.run({ scope: { projectPath: root }, operation: { type: 'catalog' } }),
    ).resolves.toMatchObject({ type: 'catalog' })
    expect(test.read).toHaveBeenCalledWith({
      projectPath: root,
      workspacePath: root,
      workspaceId: null,
    })
    await expect(
      test.run({
        scope: { projectPath: root },
        operation: { type: 'start', actionId: 'test', requestId: 'one' },
      }),
    ).rejects.toThrow('Select a Session')
    expect(test.start).not.toHaveBeenCalled()
  })

  it('derives run identity and directory from the authoritative Session binding', async () => {
    const test = fixture()
    await test.run({
      scope: { projectPath: root, sessionId: 'session' },
      operation: { type: 'start', actionId: 'test', requestId: 'one' },
    })
    expect(test.start).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: {
          workspaceId: 'bound-workspace',
          workspacePath: root,
          projectPath: root,
          sessionId: 'session',
        },
      }),
    )
  })

  it('manages definitions from the project while a planned worktree does not exist yet', async () => {
    const test = fixture(root, true)
    await test.run({
      scope: { projectPath: root, sessionId: 'session' },
      operation: { type: 'catalog' },
    })
    expect(test.read).toHaveBeenCalledWith({
      workspaceId: 'bound-workspace',
      workspacePath: root,
      projectPath: root,
      sessionId: 'session',
    })
    expect(test.start).not.toHaveBeenCalled()
  })

  it('rejects a Session from another project before executing', async () => {
    const test = fixture(tmpdir())
    await expect(
      test.run({
        scope: { projectPath: root, sessionId: 'other' },
        operation: { type: 'start', actionId: 'test', requestId: 'one' },
      }),
    ).rejects.toThrow('different project')
    expect(test.start).not.toHaveBeenCalled()
  })
})
