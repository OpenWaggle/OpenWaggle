import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_ACTION_MANIFEST,
  preparationExecutionKey,
  resolveActionCatalog,
} from '../../../domain/project-action-catalog'
import {
  catalog,
  installActionCatalogFixture,
  projectPath,
  scope,
  setup,
  shared,
} from './action-catalog.test-harness'

installActionCatalogFixture()

describe('native preparation catalog', () => {
  it.each(['move', 'save'] as const)(
    'publishes an independent private preparation over the shared phase slot with %s',
    async (method) => {
      const empty = await catalog.read(scope())
      await catalog.edit(scope(), empty.revision, {
        type: 'save-preparation',
        definition: setup,
        storage: 'local',
      })
      await shared({ ...EMPTY_ACTION_MANIFEST, preparation: [{ ...setup, id: 'teammate-setup' }] })
      const before = await catalog.read(scope())
      const published = await catalog.edit(
        scope(),
        before.revision,
        method === 'move'
          ? { type: 'move-definition', collection: 'preparation', id: setup.id, storage: 'project' }
          : { type: 'save-preparation', definition: setup, storage: 'project' },
      )
      expect(published.preparation).toHaveLength(1)
      expect(published.preparation[0]).toMatchObject({ source: 'project', definition: setup })
      const manifest = await readFile(join(projectPath, '.openwaggle/actions.json'), 'utf8')
      expect(manifest).toContain('setup')
      expect(manifest).not.toContain('teammate-setup')
    },
  )
  it('keeps an independent private setup when a shared setup arrives and can restore shared', async () => {
    const empty = await catalog.read(scope())
    await catalog.edit(scope(), empty.revision, {
      type: 'save-preparation',
      definition: setup,
      storage: 'local',
    })
    const sharedSetup = { ...setup, id: 'teammate-setup' }
    await shared({ ...EMPTY_ACTION_MANIFEST, preparation: [sharedSetup] })
    const personal = await catalog.read(scope())
    expect(personal.preparation).toHaveLength(1)
    expect(personal.preparation[0]).toMatchObject({
      definition: setup,
      source: 'override',
      review: 'enabled',
    })
    const restored = await catalog.edit(scope(), personal.revision, {
      type: 'delete-preparation',
      id: setup.id,
      storage: 'local',
    })
    expect(restored.preparation).toHaveLength(1)
    expect(restored.preparation[0]).toMatchObject({
      definition: sharedSetup,
      source: 'project',
      review: 'required',
    })
    expect(await readFile(join(projectPath, '.openwaggle/actions.json'), 'utf8')).toContain(
      'teammate-setup',
    )
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

  it('restores the exact prior shared review after a failed workspace snapshot save', async () => {
    await shared({ ...EMPTY_ACTION_MANIFEST, preparation: [setup] })
    const discovered = await catalog.read(scope())
    const initiallyEnabled = await catalog.edit(scope(), discovered.revision, {
      type: 'review-preparation',
      id: setup.id,
      enabled: true,
    })
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
    expect(changed.preparation[0]?.review).toBe('required')
    const prior = changed.preparation[0]?.previous
    expect(prior).toBeDefined()
    const approved = await catalog.edit(scope(), changed.revision, {
      type: 'review-preparation',
      id: setup.id,
      enabled: true,
    })
    const restored = await catalog.restorePreparationReview(
      scope(),
      approved.revision,
      setup.id,
      prior,
    )
    expect(restored.preparation[0]).toMatchObject({ review: 'required', previous: prior })
    await expect(
      catalog.restorePreparationReview(scope(), approved.revision, setup.id, undefined),
    ).rejects.toThrow('changed')
    expect(initiallyEnabled.preparation[0]?.review).toBe('enabled')
  })

  it('renews review when a shared setup moves into the default profile', async () => {
    const optIn = { ...setup, profileId: 'opt-in' }
    const profile = { id: 'opt-in', name: 'Opt in' }
    await shared({
      ...EMPTY_ACTION_MANIFEST,
      profiles: [profile],
      preparation: [optIn],
    })
    const discovered = await catalog.read(scope())
    const approved = await catalog.edit(scope(), discovered.revision, {
      type: 'review-preparation',
      id: optIn.id,
      enabled: true,
    })
    expect(approved.preparation[0]?.review).toBe('enabled')

    await shared({
      ...EMPTY_ACTION_MANIFEST,
      preparation: [setup],
    })
    const moved = await catalog.read(scope())
    expect(moved.preparation[0]).toMatchObject({
      definition: { id: setup.id, profileId: 'default', invocation: setup.invocation },
      review: 'required',
      previous: { profileId: 'opt-in', profileName: 'Opt in', invocation: setup.invocation },
    })
  })

  it('recovers the old profile from a review saved before profile context was stored', () => {
    const optIn = { ...setup, profileId: 'opt-in' }
    const catalog = resolveActionCatalog(
      {
        manifest: EMPTY_ACTION_MANIFEST,
        reviews: [
          {
            definitionId: setup.id,
            fingerprint: preparationExecutionKey(optIn),
            invocation: setup.invocation,
            enabled: true,
          },
        ],
        migration: { version: 1, legacySource: null },
      },
      {
        ...EMPTY_ACTION_MANIFEST,
        profiles: [{ id: 'opt-in', name: 'Opt in' }],
        preparation: [setup],
      },
      'legacy',
    )
    expect(catalog.preparation[0]).toMatchObject({
      review: 'required',
      previous: { profileId: 'opt-in', profileName: 'Opt in' },
    })
  })
})
