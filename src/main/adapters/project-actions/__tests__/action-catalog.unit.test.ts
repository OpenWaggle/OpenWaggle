import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EMPTY_ACTION_MANIFEST } from '../../../domain/project-action-catalog'
import { createActionCatalog } from '../action-catalog'
import { serializeActionManifest } from '../action-manifest-file'
import {
  action,
  catalog,
  failPublicationCompletion,
  installActionCatalogFixture,
  persistence,
  projectPath,
  root,
  rows,
  scope,
  setup,
  shared,
} from './action-catalog.test-harness'

installActionCatalogFixture()

describe('native action catalog', () => {
  it('saves locally by default without creating repository configuration and isolates independent clones', async () => {
    const empty = await catalog.read(scope())
    const saved = await catalog.edit(scope(), empty.revision, {
      type: 'save-action',
      definition: action,
      storage: 'local',
    })
    expect(saved.actions).toEqual([{ source: 'local', definition: action }])
    await expect(readFile(join(projectPath, '.openwaggle/actions.json'))).rejects.toThrow()
    await expect(readFile(join(projectPath, '.openwaggle/settings.json'))).rejects.toThrow()
    const other = join(root, 'same-remote-clone')
    await mkdir(other)
    expect((await catalog.read({ projectPath: other, workspacePath: other })).actions).toEqual([])
  })

  it('shares personal definitions across the project’s worktrees while reading shared definitions from each branch', async () => {
    const initial = await catalog.read(scope())
    await catalog.edit(scope(), initial.revision, {
      type: 'save-action',
      definition: action,
      storage: 'local',
    })
    const other = join(root, 'worktree')
    await mkdir(other)
    await shared(
      {
        ...EMPTY_ACTION_MANIFEST,
        actions: [{ ...action, id: 'branch-task', name: 'Branch task' }],
      },
      other,
    )
    const branchCatalog = await catalog.read({ projectPath, workspacePath: other })
    expect(branchCatalog.actions.map(({ definition, source }) => [definition.id, source])).toEqual([
      ['branch-task', 'project'],
      ['test', 'local'],
    ])
    expect((await catalog.read(scope())).actions.map(({ definition }) => definition.id)).toEqual([
      'test',
    ])
  })

  it('uses complete personal overrides and restores the shared version without merging fields', async () => {
    await shared({
      ...EMPTY_ACTION_MANIFEST,
      actions: [{ ...action, previewUrl: 'http://localhost:3000', autoOpenPreview: true }],
    })
    const initial = await catalog.read(scope())
    const customized = await catalog.edit(scope(), initial.revision, {
      type: 'save-action',
      definition: { ...action, name: 'My tests' },
      storage: 'local',
    })
    expect(customized.actions).toEqual([
      { source: 'override', definition: { ...action, name: 'My tests' } },
    ])
    const restored = await catalog.edit(scope(), customized.revision, {
      type: 'delete-action',
      id: action.id,
      storage: 'local',
    })
    expect(restored.actions[0]).toMatchObject({
      source: 'project',
      definition: { name: 'Test', autoOpenPreview: true, previewUrl: 'http://localhost:3000' },
    })
  })

  it('moves definitions between local and project storage with stable identities', async () => {
    const initial = await catalog.read(scope())
    const saved = await catalog.edit(scope(), initial.revision, {
      type: 'save-action',
      definition: action,
      storage: 'local',
    })
    const published = await catalog.edit(scope(), saved.revision, {
      type: 'move-definition',
      collection: 'actions',
      id: action.id,
      storage: 'project',
    })
    expect(published.actions).toEqual([{ source: 'project', definition: action }])
    expect(rows.get(projectPath)?.state.document.manifest.actions).toEqual([])
    const local = await catalog.edit(scope(), published.revision, {
      type: 'move-definition',
      collection: 'actions',
      id: action.id,
      storage: 'local',
    })
    expect(local.actions).toEqual([{ source: 'local', definition: action }])
    expect(await readFile(join(projectPath, '.openwaggle/actions.json'), 'utf8')).toBe(
      serializeActionManifest(EMPTY_ACTION_MANIFEST),
    )
  })

  it('recovers an interrupted move after the shared destination was written', async () => {
    const initial = await catalog.read(scope())
    const saved = await catalog.edit(scope(), initial.revision, {
      type: 'save-action',
      definition: action,
      storage: 'local',
    })
    failPublicationCompletion()
    await expect(
      catalog.edit(scope(), saved.revision, {
        type: 'move-definition',
        collection: 'actions',
        id: action.id,
        storage: 'project',
      }),
    ).rejects.toThrow('Simulated crash')
    expect(rows.get(projectPath)?.state.document.manifest.actions).toEqual([action])
    expect(rows.get(projectPath)?.state.pending).not.toBeNull()
    const restarted = createActionCatalog(persistence)
    expect((await restarted.read(scope())).actions).toEqual([
      { source: 'project', definition: action },
    ])
    expect(rows.get(projectPath)?.state.pending).toBeNull()
    expect(rows.get(projectPath)?.state.document.manifest.actions).toEqual([])
  })

  it('rejects stale editors after local or external edits and preserves the newer content', async () => {
    const initial = await catalog.read(scope())
    await catalog.edit(scope(), initial.revision, {
      type: 'save-action',
      definition: action,
      storage: 'local',
    })
    await expect(
      catalog.edit(scope(), initial.revision, {
        type: 'save-action',
        definition: { ...action, name: 'Stale' },
        storage: 'local',
      }),
    ).rejects.toThrow('draft has been kept')
    const fresh = await catalog.read(scope())
    await shared({ ...EMPTY_ACTION_MANIFEST, actions: [{ ...action, id: 'external' }] })
    await expect(
      catalog.edit(scope(), fresh.revision, {
        type: 'save-action',
        definition: action,
        storage: 'project',
      }),
    ).rejects.toThrow('draft has been kept')
    expect((await catalog.read(scope())).actions.map(({ definition }) => definition.id)).toEqual([
      'external',
      'test',
    ])
  })

  it('migrates legacy actions once, preserving IDs, shortcuts and setup independently', async () => {
    await mkdir(join(projectPath, '.openwaggle'))
    const legacy = JSON.stringify({
      unrelated: { value: true },
      actions: [
        {
          id: 'test',
          name: 'Tests',
          command: 'echo $T3CODE_PROJECT_ROOT',
          icon: 'test',
          runOnWorktreeCreate: true,
          shortcut: { key: 't', mod: true },
          previewUrl: 'http://localhost:5000',
          autoOpenPreview: true,
        },
      ],
    })
    await writeFile(join(projectPath, '.openwaggle/settings.json'), legacy)
    const migrated = await catalog.read(scope())
    expect(migrated.actions[0]?.definition).toMatchObject({
      id: 'test',
      name: 'Tests',
      invocation: { command: 'echo $T3CODE_PROJECT_ROOT' },
      shortcutRules: [{ shortcut: { key: 't', mod: true } }],
      previewUrl: 'http://localhost:5000',
    })
    expect(migrated.preparation[0]).toMatchObject({
      definition: { phase: 'setup', profileId: 'default' },
      review: 'enabled',
      source: 'local',
    })
    expect(rows.get(projectPath)?.state.document.migration.legacySource).toBe(legacy)
    expect(await readFile(join(projectPath, '.openwaggle/settings.json'), 'utf8')).toBe(legacy)
    await catalog.edit(scope(), migrated.revision, {
      type: 'delete-action',
      id: 'test',
      storage: 'local',
    })
    expect((await createActionCatalog(persistence).read(scope())).actions).toEqual([])
    await expect(readFile(join(projectPath, '.openwaggle/actions.json'))).rejects.toThrow()
  })

  it('keeps invalid legacy sources intact and allows migration after repair', async () => {
    await mkdir(join(projectPath, '.openwaggle'))
    await writeFile(join(projectPath, '.openwaggle/settings.json'), '{broken')
    await expect(catalog.read(scope())).rejects.toThrow()
    expect(rows.has(projectPath)).toBe(false)
    expect(await readFile(join(projectPath, '.openwaggle/settings.json'), 'utf8')).toBe('{broken')
    await writeFile(join(projectPath, '.openwaggle/settings.json'), '{}')
    expect((await catalog.read(scope())).actions).toEqual([])
  })

  it('requires enablement of shared preparation and renews review only for execution changes', async () => {
    await shared({ ...EMPTY_ACTION_MANIFEST, preparation: [setup] })
    const discovered = await catalog.read(scope())
    expect(discovered.preparation[0]?.review).toBe('required')
    const enabled = await catalog.edit(scope(), discovered.revision, {
      type: 'review-preparation',
      id: setup.id,
      enabled: true,
    })
    expect(enabled.preparation[0]?.review).toBe('enabled')
    await shared({
      ...EMPTY_ACTION_MANIFEST,
      profiles: [{ id: 'default', name: 'Renamed profile' }],
      preparation: [setup],
    })
    expect((await catalog.read(scope())).preparation[0]?.review).toBe('enabled')
    await shared({
      ...EMPTY_ACTION_MANIFEST,
      preparation: [
        {
          ...setup,
          invocation: {
            type: 'command',
            command: 'pnpm install --frozen-lockfile',
            directory: '.',
          },
        },
      ],
    })
    const changed = await catalog.read(scope())
    expect(changed.preparation[0]).toMatchObject({
      review: 'required',
      previous: { invocation: setup.invocation },
    })
    const disabled = await catalog.edit(scope(), changed.revision, {
      type: 'review-preparation',
      id: setup.id,
      enabled: false,
    })
    expect(disabled.preparation[0]?.review).toBe('disabled')
    const raw = await readFile(join(projectPath, '.openwaggle/actions.json'), 'utf8')
    expect(raw).not.toContain('reviews')
    expect(raw).not.toContain('enabled')
  })

  it('surfaces malformed shared configuration and rejects symlinked configuration', async () => {
    await mkdir(join(projectPath, '.openwaggle'))
    await writeFile(join(projectPath, '.openwaggle/actions.json'), '{broken')
    await expect(catalog.read(scope())).rejects.toThrow('Invalid .openwaggle/actions.json')
    await rm(join(projectPath, '.openwaggle/actions.json'))
    await symlink(join(root, 'missing'), join(projectPath, '.openwaggle/actions.json'))
    await expect(catalog.read(scope())).rejects.toThrow('symbolic link')
  })
})
