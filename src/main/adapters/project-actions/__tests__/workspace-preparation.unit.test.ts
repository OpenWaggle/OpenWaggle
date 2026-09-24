import { decodeUnknownExactOrThrow, parseJsonUnknown } from '@shared/schema'
import { storedWorkspacePreparationSchema } from '@shared/schemas/workspace-preparation'
import type { ActionCatalog } from '@shared/types/action-definitions'
import { describe, expect, it, vi } from 'vitest'
import type { ActionRunWorkspace } from '../../../ports/action-run-service'
import {
  ManagedWorkspacePreparation,
  type PreparationDependencies,
} from '../managed-workspace-preparation'
import type { StoredWorkspacePreparation } from '../preparation-persistence'
import { acknowledgePreparationStart } from '../preparation-start-acknowledgement'

const workspace: ActionRunWorkspace = {
  workspaceId: 'first',
  projectPath: '/repo',
  workspacePath: '/repo/worktree',
}
function fixture() {
  const storage = new Map<string, StoredWorkspacePreparation>()
  let catalog: ActionCatalog = {
    revision: 'one',
    actions: [],
    profiles: [{ source: 'local', definition: { id: 'default', name: 'Default' } }],
    preparation: [
      {
        source: 'local',
        review: 'enabled',
        definition: {
          id: 'setup',
          profileId: 'default',
          phase: 'setup',
          invocation: { type: 'command', command: 'export TEST_READY=yes', directory: '.' },
        },
      },
    ],
  }
  const execute = vi.fn<PreparationDependencies['execute']>(async ({ onOutput }) => {
    onOutput('ready\n')
    return { exitCode: 0, environment: { TEST_READY: 'yes' } }
  })
  const release = vi.fn()
  const persistence = {
    read: async (id: string) => storage.get(id) ?? null,
    list: async () => [...storage.values()],
    write: async (state: StoredWorkspacePreparation, revision: number) => {
      if ((storage.get(state.workspaceId)?.revision ?? 0) !== revision)
        throw new Error('revision conflict')
      storage.set(state.workspaceId, structuredClone(state))
    },
  }
  const deps: PreparationDependencies = {
    persistence,
    catalog: async () => catalog,
    execute,
    acquireLiveness: () => release,
  }
  return {
    engine: new ManagedWorkspacePreparation(deps),
    deps,
    execute,
    release,
    storage,
    change: (next: ActionCatalog) => {
      catalog = next
    },
    catalog: () => catalog,
  }
}
describe('Workspace preparation lifecycle', () => {
  it('persists removals across reload and supplies them to cleanup without exposing private environment', async () => {
    const test = fixture()
    test.change({
      ...test.catalog(),
      preparation: [
        ...test.catalog().preparation,
        {
          source: 'local',
          review: 'enabled',
          definition: {
            id: 'cleanup',
            profileId: 'default',
            phase: 'cleanup',
            invocation: { type: 'command', command: 'cleanup', directory: '.' },
          },
        },
      ],
    })
    const environment = { HTTPS_PROXY: null, TEST_READY: 'yes', EMPTY: '' }
    test.execute.mockResolvedValueOnce({ exitCode: 0, environment })
    await test.engine.capture(workspace)
    const legacy = test.storage.get(workspace.workspaceId)
    expect(decodeUnknownExactOrThrow(storedWorkspacePreparationSchema, legacy).environment).toEqual(
      {},
    )
    await test.engine.run(workspace, 'setup')
    const saved = decodeUnknownExactOrThrow(
      storedWorkspacePreparationSchema,
      parseJsonUnknown(JSON.stringify(test.storage.get(workspace.workspaceId))),
    )
    test.storage.set(workspace.workspaceId, saved)
    const restarted = new ManagedWorkspacePreparation(test.deps)
    expect(await restarted.environment(workspace.workspaceId)).toEqual(environment)
    await restarted.run(workspace, 'cleanup')
    expect(test.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({ captureEnvironment: false, environment }),
    )
    expect(await restarted.read(workspace)).not.toHaveProperty('environment')
  })
  it('resets completed execution and private exports for a recreated checkout, keeping its snapshot', async () => {
    const test = fixture()
    const captured = await test.engine.capture(workspace)
    await test.engine.run(workspace, 'setup', captured.revision)
    expect(await test.engine.environment(workspace.workspaceId)).toEqual({ TEST_READY: 'yes' })
    const recreated = await test.engine.prepareBirth(workspace)
    expect(recreated.snapshot).toEqual(captured.snapshot)
    expect(recreated.setup.status).toBe('idle')
    expect(await test.engine.environment(workspace.workspaceId)).toEqual({})
    await test.engine.requireSetup(workspace)
    expect(test.execute).toHaveBeenCalledTimes(2)
  })

  it('stops only the selected setup attempt and retains ownership until execution drains', async () => {
    const test = fixture()
    test.execute.mockImplementationOnce(
      ({ signal }) =>
        new Promise((resolve) => {
          signal?.addEventListener(
            'abort',
            () => resolve({ exitCode: 0, environment: { PARTIAL: 'no' } }),
            { once: true },
          )
        }),
    )
    const captured = await test.engine.capture(workspace)
    const started = await acknowledgePreparationStart((onStarted) =>
      test.engine.run(workspace, 'setup', captured.revision, onStarted),
    )
    await expect(test.engine.stopSetup(workspace, 'stale-attempt')).rejects.toThrow(
      'attempt changed',
    )
    expect(test.release).not.toHaveBeenCalled()
    const stopped = await test.engine.stopSetup(workspace, started.setup.attemptId ?? '')
    expect(stopped.setup.status).toBe('failed')
    expect(stopped.setup.error).toContain('setup stopped')
    expect(await test.engine.environment(workspace.workspaceId)).toEqual({})
    expect(test.release).toHaveBeenCalledOnce()
  })
  it('retains pinned recovery when current project configuration becomes invalid', async () => {
    const test = fixture()
    const captured = await test.engine.capture(workspace)
    vi.spyOn(test.deps, 'catalog').mockRejectedValue(new Error('Invalid actions.json'))
    const read = await test.engine.read(workspace)
    expect(read?.snapshot).toEqual(captured.snapshot)
    expect(read?.catalogError).toBe('Invalid actions.json')
    const completed = await test.engine.run(workspace, 'setup', captured.revision)
    expect(completed.setup.status).toBe('succeeded')
    expect(completed.catalogError).toBe('Invalid actions.json')
    await expect(test.engine.adopt(workspace, completed.revision)).rejects.toThrow(
      'Invalid actions.json',
    )
    expect((await test.engine.skip(workspace, 'cleanup', completed.revision)).cleanup.status).toBe(
      'skipped',
    )
  })
  it('acknowledges durable setup before completion while the first turn waits for the same attempt', async () => {
    const test = fixture()
    const finish = Promise.withResolvers<{ exitCode: number; environment: { READY: string } }>()
    test.execute.mockImplementationOnce(() => finish.promise)
    const snapshot = await test.engine.capture(workspace)
    const receipt = await acknowledgePreparationStart((started) =>
      test.engine.run(workspace, 'setup', snapshot.revision, started),
    )
    expect(receipt.setup.status).toBe('running')
    expect(test.storage.get(workspace.workspaceId)?.setup.attemptId).toBe(receipt.setup.attemptId)
    expect(test.release).not.toHaveBeenCalled()
    const firstTurn = test.engine.requireSetup(workspace)
    const completed = vi.fn()
    void firstTurn.then(completed)
    await Promise.resolve()
    expect(completed).not.toHaveBeenCalled()
    finish.resolve({ exitCode: 0, environment: { READY: 'yes' } })
    await firstTurn
    expect(test.execute).toHaveBeenCalledTimes(1)
    expect(test.release).toHaveBeenCalledTimes(1)
    expect(await test.engine.environment(workspace.workspaceId)).toEqual({ READY: 'yes' })
  })
  it('pins reviewed definitions and requires explicit adoption of later changes', async () => {
    const test = fixture()
    await test.engine.capture(workspace)
    test.change({
      ...test.catalog(),
      preparation: [
        {
          ...test.catalog().preparation[0],
          source: 'project',
          review: 'required',
          definition: {
            id: 'setup',
            profileId: 'default',
            phase: 'setup',
            invocation: { type: 'command', command: 'different', directory: '.' },
          },
        },
      ],
    })
    await test.engine.requireSetup(workspace)
    expect(test.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        invocation: expect.objectContaining({ command: 'export TEST_READY=yes' }),
      }),
    )
    const state = await test.engine.read(workspace)
    expect(state).toMatchObject({
      updateAvailable: true,
      setup: { status: 'succeeded', output: 'ready\n' },
    })
    if (!state) throw new Error('missing state')
    const adopted = await test.engine.adopt(workspace, state.revision)
    expect(adopted.setup.status).toBe('idle')
    await expect(test.engine.requireSetup(workspace)).rejects.toThrow('review-required')
    expect(test.execute).toHaveBeenCalledTimes(1)
  })
  it('blocks after failure until retry or an explicit Continue anyway, without publishing exports', async () => {
    const test = fixture()
    test.execute.mockResolvedValueOnce({
      exitCode: 7,
      environment: { FAILED_EXPORT: 'do not publish', HTTPS_PROXY: null },
    })
    await test.engine.capture(workspace)
    await expect(test.engine.requireSetup(workspace)).rejects.toThrow('failed')
    await expect(test.engine.requireSetup(workspace)).rejects.toThrow('failed')
    expect(test.execute).toHaveBeenCalledTimes(1)
    expect(await test.engine.environment(workspace.workspaceId)).toEqual({})
    const state = await test.engine.read(workspace)
    if (!state) throw new Error('missing state')
    await test.engine.skip(workspace, 'setup', state.revision)
    await expect(test.engine.requireSetup(workspace)).resolves.toBeUndefined()
    expect(test.execute).toHaveBeenCalledTimes(1)
  })
  it('shares one in-flight setup and isolates exports between Workspaces', async () => {
    const test = fixture()
    const finish = Promise.withResolvers<{ exitCode: number; environment: { TOKEN: string } }>()
    test.execute.mockImplementationOnce(() => finish.promise)
    await test.engine.capture(workspace)
    const first = test.engine.requireSetup(workspace)
    await vi.waitFor(() => expect(test.execute).toHaveBeenCalledTimes(1))
    const second = test.engine.requireSetup(workspace)
    finish.resolve({ exitCode: 0, environment: { TOKEN: 'private' } })
    await Promise.all([first, second])
    expect(test.execute).toHaveBeenCalledTimes(1)
    expect(await test.engine.environment('first')).toEqual({ TOKEN: 'private' })
    expect(await test.engine.environment('other')).toEqual({})
    expect(await test.engine.read(workspace)).not.toHaveProperty('environment')
    expect(test.release).toHaveBeenCalledTimes(1)
  })
  it('rejects stale snapshot approval and remembers Keep disabled for the pinned definition', async () => {
    const test = fixture()
    test.change({
      ...test.catalog(),
      preparation: test
        .catalog()
        .preparation.map((entry) => ({ ...entry, source: 'project', review: 'required' })),
    })
    const state = await test.engine.capture(workspace)
    await expect(test.engine.review(workspace, 'setup', true, state.revision - 1)).rejects.toThrow(
      'changed',
    )
    await test.engine.review(workspace, 'setup', false, state.revision)
    expect((await test.engine.read(workspace))?.snapshot.definitions[0]?.previous).toMatchObject({
      profileId: 'default',
      profileName: 'Default',
    })
    await test.engine.requireSetup(workspace)
    expect(test.execute).not.toHaveBeenCalled()
    expect(await test.engine.read(workspace)).toMatchObject({ setup: { status: 'skipped' } })
  })
  it('does not revive an interrupted setup after Host loss', async () => {
    const test = fixture()
    await test.engine.capture(workspace)
    const state = test.storage.get('first')
    if (!state) throw new Error('missing state')
    test.storage.set('first', {
      ...state,
      setup: { ...state.setup, status: 'running', output: 'last retained line' },
    })
    const restarted = new ManagedWorkspacePreparation(test.deps)
    await restarted.recoverAfterHostLoss()
    await expect(restarted.requireSetup(workspace)).rejects.toThrow('failed')
    expect(test.execute).not.toHaveBeenCalled()
    expect(await restarted.read(workspace)).toMatchObject({
      setup: { output: 'last retained line' },
    })
  })
})
