import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ActionManagementRequest } from '@shared/types/action-management'
import type { WorkspacePreparation } from '@shared/types/workspace-preparation'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceGenerationCheck } from '../../domain/workspace-generation'
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
    const inspectWorkspaceGeneration = vi.fn(() =>
      Effect.succeed<WorkspaceGenerationCheck>({ status: 'current' }),
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
            fromPartial({ read: preparationRead, inspectWorkspaceGeneration }),
          ),
        ),
      )
    return { run, start, read, getBound, preparationRead, inspectWorkspaceGeneration }
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

  const pinnedCleanup = fromPartial<WorkspacePreparation['snapshot']['definitions'][number]>({
    definition: { id: 'cleanup', profileId: 'default', phase: 'cleanup' },
    review: 'enabled',
  })
  function replacedCheckout(test: ReturnType<typeof fixture>) {
    test.inspectWorkspaceGeneration.mockReturnValue(
      Effect.succeed({
        status: 'replaced',
        workspacePath: root,
        recorded: { device: '1', inode: '2', birthtime: '0' },
        observed: { device: '1', inode: '4', birthtime: '0' },
      }),
    )
  }

  it('retains a replaced checkout for Delete anyway even when cleanup previously succeeded', async () => {
    const test = fixture()
    test.preparationRead.mockReturnValue(
      Effect.succeed(
        fromPartial<WorkspacePreparation>({
          workspaceId: 'retained',
          snapshot: { definitions: [pinnedCleanup] },
          cleanup: { status: 'succeeded' },
        }),
      ),
    )
    replacedCheckout(test)

    await expect(
      test.run({ scope: { projectPath: root }, operation: { type: 'retained-preparation' } }),
    ).resolves.toMatchObject({
      workspaces: [
        {
          path: root,
          generationMismatch: true,
          generationMismatchMessage: `This worktree no longer matches the checkout that captured its preparation: ${root} is a different folder from the one that was prepared. Its pinned cleanup cannot run here. Choose Delete anyway to remove this checkout without running that cleanup. Prepared: inode 2, unknown creation time, device 1; found: inode 4, unknown creation time, device 1.`,
          preparation: { cleanup: { status: 'succeeded' } },
        },
      ],
    })
  })

  it('leaves out a replaced checkout whose snapshot pins no cleanup, so Remove works normally', async () => {
    const test = fixture()
    test.preparationRead.mockReturnValue(
      Effect.succeed(
        fromPartial<WorkspacePreparation>({
          workspaceId: 'retained',
          snapshot: { definitions: [] },
          cleanup: { status: 'idle' },
        }),
      ),
    )
    replacedCheckout(test)

    await expect(
      test.run({ scope: { projectPath: root }, operation: { type: 'retained-preparation' } }),
    ).resolves.toMatchObject({ type: 'retained-preparation', workspaces: [] })
  })

  it('lists a replaced checkout without cleanup whose Git removal did not finish, without a mismatch', async () => {
    const test = fixture()
    test.preparationRead.mockReturnValue(
      Effect.succeed(
        fromPartial<WorkspacePreparation>({
          workspaceId: 'retained',
          snapshot: { definitions: [] },
          cleanup: { status: 'skipped' },
        }),
      ),
    )
    replacedCheckout(test)

    const result = await test.run({
      scope: { projectPath: root },
      operation: { type: 'retained-preparation' },
    })
    if (result.type !== 'retained-preparation') throw new Error(`unexpected ${result.type}`)
    expect(result.workspaces).toHaveLength(1)
    const [row] = result.workspaces
    expect(row).toMatchObject({ path: root, preparation: { cleanup: { status: 'skipped' } } })
    expect(row).not.toHaveProperty('generationMismatch')
    expect(row).not.toHaveProperty('generationMismatchMessage')
  })

  it('retains a checkout after successful cleanup when Git removal did not finish', async () => {
    const test = fixture()
    test.preparationRead.mockReturnValue(
      Effect.succeed(
        fromPartial<WorkspacePreparation>({
          workspaceId: 'retained',
          cleanup: { status: 'succeeded' },
        }),
      ),
    )

    await expect(
      test.run({ scope: { projectPath: root }, operation: { type: 'retained-preparation' } }),
    ).resolves.toMatchObject({
      workspaces: [{ path: root, preparation: { cleanup: { status: 'succeeded' } } }],
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
