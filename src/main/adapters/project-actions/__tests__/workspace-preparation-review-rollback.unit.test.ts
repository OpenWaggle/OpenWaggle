import type { ActionCatalog } from '@shared/types/action-definitions'
import { expect, it, vi } from 'vitest'
import type { ActionRunWorkspace } from '../../../ports/action-run-service'
import { ManagedWorkspacePreparation } from '../managed-workspace-preparation'
import type { StoredWorkspacePreparation } from '../preparation-persistence'

const workspace: ActionRunWorkspace = {
  workspaceId: 'first',
  projectPath: '/repo',
  workspacePath: '/repo/worktree',
}

it('undoes a shared setup approval if saving the reviewed snapshot fails', async () => {
  const storage = new Map<string, StoredWorkspacePreparation>()
  let review: 'required' | 'enabled' = 'required'
  const catalog = async (): Promise<ActionCatalog> => ({
    revision: 'one',
    actions: [],
    profiles: [{ source: 'local', definition: { id: 'default', name: 'Default' } }],
    preparation: [
      {
        source: 'project',
        review,
        definition: {
          id: 'setup',
          profileId: 'default',
          phase: 'setup',
          invocation: { type: 'command', command: 'export READY=yes', directory: '.' },
        },
      },
    ],
  })
  const write = vi.fn(async (state: StoredWorkspacePreparation, expectedRevision: number) => {
    if ((storage.get(state.workspaceId)?.revision ?? 0) !== expectedRevision)
      throw new Error('revision conflict')
    storage.set(state.workspaceId, structuredClone(state))
  })
  const rememberReview = vi.fn(async () => {
    review = 'enabled'
    return async () => {
      review = 'required'
    }
  })
  const engine = new ManagedWorkspacePreparation({
    persistence: {
      read: async (id) => storage.get(id) ?? null,
      list: async () => [...storage.values()],
      write,
    },
    catalog,
    rememberReview,
    execute: async () => ({ exitCode: 0, environment: {} }),
    acquireLiveness: () => () => {},
  })
  const captured = await engine.capture(workspace)
  write.mockRejectedValueOnce(new Error('snapshot save failed'))

  await expect(engine.review(workspace, 'setup', true, captured.revision)).rejects.toThrow(
    'snapshot save failed',
  )
  expect(rememberReview).toHaveBeenCalledOnce()
  expect((await engine.read(workspace))?.snapshot.definitions[0]?.review).toBe('required')
  const later = await engine.capture({ ...workspace, workspaceId: 'later' })
  expect(later.snapshot.definitions[0]?.review).toBe('required')
})
