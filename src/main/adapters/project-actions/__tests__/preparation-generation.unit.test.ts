import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ActionCatalog } from '@shared/types/action-definitions'
import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it } from 'vitest'
import {
  ManagedWorkspacePreparation,
  type PreparationDependencies,
} from '../managed-workspace-preparation'
import type { StoredWorkspacePreparation } from '../preparation-persistence'

const catalog: ActionCatalog = {
  revision: 'one',
  actions: [],
  profiles: [{ source: 'local', definition: { id: 'default', name: 'Default' } }],
  preparation: [],
}

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
    expect(await engine.isCurrentWorkspaceGeneration(workspace)).toBe(true)
    await fs.rename(originalPath, path.join(root, 'removed-worktree'))
    await fs.mkdir(originalPath)
    const restarted = new ManagedWorkspacePreparation(deps)
    expect(await restarted.isCurrentWorkspaceGeneration(workspace)).toBe(false)

    const recorded = storage.get(workspace.workspaceId)
    if (!recorded) throw new Error('missing preparation')
    const { workspaceIdentity: _identity, ...legacy } = recorded
    storage.set(workspace.workspaceId, legacy)
    expect(await restarted.isCurrentWorkspaceGeneration(workspace)).toBe(false)

    const pending = await restarted.prepareBirth({ ...workspace, workspacePath: root })
    expect((await restarted.prepareBirth({ ...workspace, workspacePath: root })).revision).toBe(
      pending.revision,
    )
    await restarted.capture(workspace)
    expect(await restarted.isCurrentWorkspaceGeneration(workspace)).toBe(true)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
