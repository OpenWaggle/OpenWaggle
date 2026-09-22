import type { ActionCatalog } from '@shared/types/action-definitions'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ManagedWorkspacePreparation,
  type PreparationDependencies,
} from '../managed-workspace-preparation'
import type { StoredWorkspacePreparation } from '../preparation-persistence'

const workspace = { workspaceId: 'workspace', projectPath: '/repo', workspacePath: '/worktree' }
const catalog: ActionCatalog = {
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
        invocation: { type: 'command', command: 'setup', directory: '.' },
      },
    },
  ],
}

function fixture() {
  let stored: StoredWorkspacePreparation | null = null
  let unavailable = false
  const entered = Promise.withResolvers<void>()
  const completed = Promise.withResolvers<void>()
  const release = vi.fn()
  const write = vi.fn<PreparationDependencies['persistence']['write']>(async (next, revision) => {
    if (unavailable) throw new Error('Preparation storage is unavailable')
    if ((stored?.revision ?? 0) !== revision) throw new Error('Preparation revision conflict')
    stored = structuredClone(next)
  })
  const execute = vi.fn<PreparationDependencies['execute']>(async ({ onOutput }) => {
    onOutput('setup output\n')
    entered.resolve()
    await completed.promise
    return { exitCode: 0, environment: { READY: 'yes' } }
  })
  const engine = new ManagedWorkspacePreparation({
    persistence: { read: async () => stored, list: async () => (stored ? [stored] : []), write },
    catalog: async () => catalog,
    execute,
    acquireLiveness: () => release,
  })
  return {
    engine,
    execute,
    write,
    release,
    entered: entered.promise,
    finish: () => completed.resolve(),
    unavailable: (value: boolean) => {
      unavailable = value
    },
    stored: () => stored,
  }
}

afterEach(() => vi.useRealTimers())

describe('preparation persistence failure recovery', () => {
  it('saves the final result after a transient output checkpoint failure', async () => {
    vi.useFakeTimers()
    const test = fixture()
    await test.engine.capture(workspace)
    const running = test.engine.run(workspace, 'setup')
    const result = running.then(
      (state) => ({ state }),
      (error: unknown) => ({ error }),
    )
    await test.entered
    test.unavailable(true)
    await vi.advanceTimersByTimeAsync(1_000)
    test.unavailable(false)
    test.finish()
    expect(await result).toMatchObject({ state: { setup: { status: 'succeeded' } } })
    expect(test.stored()?.setup).toMatchObject({ status: 'succeeded', output: 'setup output\n' })
    expect(await test.engine.environment(workspace.workspaceId)).toEqual({ READY: 'yes' })
    expect(test.release).toHaveBeenCalledOnce()
    expect(test.execute).toHaveBeenCalledOnce()
  })

  it.each([
    { recovery: 'retry', checkpoint: false },
    { recovery: 'retry', checkpoint: true },
    { recovery: 'continue', checkpoint: false },
    { recovery: 'continue', checkpoint: true },
  ] as const)(
    'keeps a failed final save visible and allows $recovery after storage recovers, checkpoint=$checkpoint',
    async ({ recovery, checkpoint }) => {
      vi.useFakeTimers()
      const test = fixture()
      await test.engine.capture(workspace)
      const running = test.engine.run(workspace, 'setup')
      const failed = expect(running).rejects.toThrow('Preparation storage is unavailable')
      await test.entered
      if (checkpoint) await vi.advanceTimersByTimeAsync(1_000)
      test.unavailable(true)
      test.finish()
      await failed
      const retained = await test.engine.read(workspace)
      expect(retained?.setup).toMatchObject({
        status: 'failed',
        output: 'setup output\n',
        error: expect.stringContaining('Preparation storage is unavailable'),
      })
      expect(retained?.revision).toBe(test.stored()?.revision)
      expect(await test.engine.environment(workspace.workspaceId)).toEqual({})
      expect(test.release).toHaveBeenCalledOnce()
      if (!retained) throw new Error('Missing retained preparation failure')

      test.unavailable(false)
      if (recovery === 'retry') {
        await test.engine.run(workspace, 'setup', retained.revision)
        expect((await test.engine.read(workspace))?.setup.status).toBe('succeeded')
        expect(await test.engine.environment(workspace.workspaceId)).toEqual({ READY: 'yes' })
        expect(test.release).toHaveBeenCalledTimes(2)
      } else {
        await test.engine.skip(workspace, 'setup', retained.revision)
        await expect(test.engine.requireSetup(workspace)).resolves.toBeUndefined()
        expect((await test.engine.read(workspace))?.setup.status).toBe('skipped')
        expect(test.execute).toHaveBeenCalledOnce()
      }
    },
  )
})
