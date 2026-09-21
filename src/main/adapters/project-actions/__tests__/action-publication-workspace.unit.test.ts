import { lstat, mkdir, readFile, rename, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EMPTY_ACTION_MANIFEST } from '../../../domain/project-action-catalog'
import { createActionCatalog } from '../action-catalog'
import { actionContentRevision, writeActionManifest } from '../action-manifest-file'
import {
  action,
  catalog,
  failPublicationBeforeWrite,
  installActionCatalogFixture,
  persistence,
  projectPath,
  root,
  rows,
  scope,
  shared,
  workspaces,
} from './action-catalog.test-harness'

installActionCatalogFixture()

async function interruptPublication() {
  const workspacePath = join(root, 'worktree')
  await mkdir(workspacePath)
  const workspace = { projectPath, workspacePath }
  workspaces.set(workspacePath, { id: 'original', ready: true })
  const initial = await catalog.read(workspace)
  const personal = await catalog.edit(workspace, initial.revision, {
    type: 'save-action',
    definition: action,
    storage: 'local',
  })
  failPublicationBeforeWrite()
  await expect(
    catalog.edit(workspace, personal.revision, {
      type: 'move-definition',
      collection: 'actions',
      id: action.id,
      storage: 'project',
    }),
  ).rejects.toThrow('Simulated crash before publishing')
  return workspacePath
}

async function expectRetainedDraft(workspacePath: string) {
  const before = structuredClone(rows.get(projectPath))
  const recovered = await createActionCatalog(persistence).read(scope())
  expect(rows.get(projectPath)).toEqual(before)
  expect(recovered.actions).toEqual([{ source: 'local', definition: action }])
  expect(recovered.pendingPublication).toMatchObject({
    workspacePath,
    projectDraft: { actions: [action] },
    localDraft: { actions: [] },
  })
  return recovered
}

describe('publication workspace identity', () => {
  it('resumes a journal before the file write when the same workspace still exists', async () => {
    const workspacePath = await interruptPublication()
    await createActionCatalog(persistence).read(scope())
    expect(rows.get(projectPath)?.state.pending).toBeNull()
    expect(await readFile(join(workspacePath, '.openwaggle/actions.json'), 'utf8')).toContain(
      'pnpm test',
    )
  })

  it('keeps a missing workspace absent and exposes its drafts through the project catalog', async () => {
    const workspacePath = await interruptPublication()
    await rm(workspacePath, { recursive: true })
    const recovered = await expectRetainedDraft(workspacePath)
    await expect(lstat(workspacePath)).rejects.toMatchObject({ code: 'ENOENT' })
    const discarded = await catalog.edit(scope(), recovered.revision, {
      type: 'discard-publication',
    })
    expect(discarded.pendingPublication).toBeUndefined()
    expect(discarded.actions).toEqual(recovered.actions)
  })

  it.each(['directory', 'symlink'] as const)(
    'does not publish into a replacement %s at the saved path',
    async (replacement) => {
      const workspacePath = await interruptPublication()
      const moved = join(root, 'original-worktree')
      await rename(workspacePath, moved)
      if (replacement === 'directory') await mkdir(workspacePath)
      else await symlink(moved, workspacePath, 'dir')
      await expectRetainedDraft(workspacePath)
      await expect(lstat(join(workspacePath, '.openwaggle'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
      await expect(lstat(join(moved, '.openwaggle'))).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )

  it.each(['deleted', 'releasing', 'replaced'] as const)(
    'retains drafts when the resource is %s but its directory remains',
    async (state) => {
      const workspacePath = await interruptPublication()
      if (state === 'deleted') workspaces.delete(workspacePath)
      else
        workspaces.set(workspacePath, {
          id: state === 'replaced' ? 'new-owner' : 'original',
          ready: state === 'replaced',
        })
      await expectRetainedDraft(workspacePath)
      await expect(lstat(join(workspacePath, '.openwaggle'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    },
  )

  it('does not complete a journal against matching content in a replacement checkout', async () => {
    const workspacePath = await interruptPublication()
    await rename(workspacePath, join(root, 'previous-worktree'))
    await mkdir(workspacePath)
    await shared({ ...EMPTY_ACTION_MANIFEST, actions: [action] }, workspacePath)
    await expectRetainedDraft(workspacePath)
  })

  it('retains an older journal that cannot prove the original workspace identity', async () => {
    const workspacePath = await interruptPublication()
    const stored = rows.get(projectPath)
    if (!stored?.state.pending) throw new Error('Missing pending publication')
    const { workspaceIdentity: _identity, ...pending } = stored.state.pending
    rows.set(projectPath, { ...stored, state: { ...stored.state, pending } })
    await expectRetainedDraft(workspacePath)
    await expect(lstat(join(workspacePath, '.openwaggle'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('cannot recreate a root that disappears between the final guard and configuration mkdir', async () => {
    const workspacePath = join(root, 'removed-during-save')
    await mkdir(workspacePath)
    await expect(
      writeActionManifest(
        workspacePath,
        actionContentRevision(null),
        EMPTY_ACTION_MANIFEST,
        async () => {
          await rm(workspacePath, { recursive: true, force: true })
        },
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(workspacePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
