import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ManagedWorkspacePreparation } from '../managed-workspace-preparation'
import type { StoredWorkspacePreparation } from '../preparation-persistence'
import { memoryDeps } from './preparation-generation.test-harness'

vi.mock('../../../logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

let root = ''
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-local-prep-')))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

/** A local Workspace runs in the opened checkout, so its path is the project path. */
function localWorkspace() {
  return { workspaceId: 'local-workspace', projectPath: root, workspacePath: root }
}

describe('a local Workspace preparation', () => {
  it('does not claim a pending worktree birth when captured', async () => {
    const { storage, deps } = memoryDeps()

    await new ManagedWorkspacePreparation(deps).capture(localWorkspace())

    const stored = storage.get('local-workspace')
    expect(stored).toBeDefined()
    expect(stored).not.toHaveProperty('awaitingWorktreeBirth')
    expect(stored).not.toHaveProperty('awaitingWorktreeBirthSince')
    expect(stored).not.toHaveProperty('workspaceIdentity')
  })

  it('does not claim a pending worktree birth when another profile is chosen', async () => {
    const { storage, deps } = memoryDeps()
    const engine = new ManagedWorkspacePreparation(deps)
    const captured = await engine.capture(localWorkspace())

    await engine.select(localWorkspace(), 'default', captured?.revision ?? 0)

    expect(storage.get('local-workspace')).not.toHaveProperty('awaitingWorktreeBirth')
  })

  it('still marks a managed worktree birth pending before Git creates the folder', async () => {
    // A pending managed worktree also uses the project path until `git worktree add` runs.
    const { storage, deps } = memoryDeps()
    const pending = { workspaceId: 'managed', projectPath: root, workspacePath: root }

    await new ManagedWorkspacePreparation(deps).prepareBirth(pending)

    expect(storage.get('managed')).toMatchObject({
      awaitingWorktreeBirth: true,
      awaitingWorktreeBirthSince: expect.any(Number),
    })
  })
})

describe('local preparations stored by older builds', () => {
  function legacyLocalRecord(
    template: StoredWorkspacePreparation,
    workspaceId: string,
  ): StoredWorkspacePreparation {
    return {
      ...template,
      workspaceId,
      awaitingWorktreeBirth: true,
      awaitingWorktreeBirthSince: 1_700_000_000_000,
    }
  }

  it('clears the birth flag of local Workspaces at Host start and leaves worktree births alone', async () => {
    const { storage, deps } = memoryDeps()
    const localIds = new Set(['local-workspace'])
    const engine = new ManagedWorkspacePreparation({
      ...deps,
      listLocalWorkspaceIds: async () => localIds,
    })
    await engine.capture(localWorkspace())
    await engine.prepareBirth({ workspaceId: 'managed', projectPath: root, workspacePath: root })
    const captured = storage.get('local-workspace')
    if (!captured) throw new Error('missing local preparation')
    storage.set('local-workspace', legacyLocalRecord(captured, 'local-workspace'))
    const managedBefore = storage.get('managed')

    await engine.recoverAfterHostLoss()

    const local = storage.get('local-workspace')
    expect(local).not.toHaveProperty('awaitingWorktreeBirth')
    expect(local).not.toHaveProperty('awaitingWorktreeBirthSince')
    expect(local?.revision).toBe(captured.revision + 1)
    expect(storage.get('managed')).toEqual(managedBefore)
  })

  it('leaves every record alone when the local Workspaces cannot be listed', async () => {
    const { storage, deps } = memoryDeps()
    const engine = new ManagedWorkspacePreparation(deps)
    await engine.capture(localWorkspace())
    const captured = storage.get('local-workspace')
    if (!captured) throw new Error('missing local preparation')
    const legacy = legacyLocalRecord(captured, 'local-workspace')
    storage.set('local-workspace', legacy)

    await engine.recoverAfterHostLoss()

    expect(storage.get('local-workspace')).toEqual(legacy)
  })
})
