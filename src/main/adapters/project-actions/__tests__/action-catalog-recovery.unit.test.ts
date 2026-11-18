import { describe, expect, it } from 'vitest'
import { EMPTY_ACTION_MANIFEST } from '../../../domain/project-action-catalog'
import {
  action,
  catalog,
  failPublicationCompletion,
  installActionCatalogFixture,
  projectPath,
  rows,
  scope,
  setup,
  shared,
} from './action-catalog.test-harness'

installActionCatalogFixture()

describe('action publication recovery and portable profiles', () => {
  it('publishes an edited private definition without leaving a stale personal override', async () => {
    const initial = await catalog.read(scope())
    const personal = await catalog.edit(scope(), initial.revision, {
      type: 'save-action',
      definition: action,
      storage: 'local',
    })
    const published = await catalog.edit(scope(), personal.revision, {
      type: 'save-action',
      definition: { ...action, name: 'Shared test' },
      storage: 'project',
    })
    expect(published.actions).toEqual([
      { source: 'project', definition: { ...action, name: 'Shared test' } },
    ])
    const setupLocal = await catalog.edit(scope(), published.revision, {
      type: 'save-preparation',
      definition: setup,
      storage: 'local',
    })
    const setupShared = await catalog.edit(scope(), setupLocal.revision, {
      type: 'save-preparation',
      definition: setup,
      storage: 'project',
    })
    expect(setupShared.preparation[0]).toMatchObject({ source: 'project', definition: setup })
  })
  it('retains conflicting drafts, exposes recovery, and preserves current definitions on discard', async () => {
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
    await shared({
      ...EMPTY_ACTION_MANIFEST,
      actions: [{ ...action, id: 'external', name: 'External edit' }],
    })
    const recovered = await catalog.read(scope())
    expect(recovered.pendingPublication?.projectDraft.actions).toEqual([action])
    expect(recovered.actions.map(({ definition }) => definition.id)).toEqual(['external', 'test'])
    await expect(
      catalog.edit(scope(), recovered.revision, {
        type: 'save-action',
        definition: action,
        storage: 'local',
      }),
    ).rejects.toThrow('retained drafts')
    const resolved = await catalog.edit(scope(), recovered.revision, {
      type: 'discard-publication',
    })
    expect(resolved.pendingPublication).toBeUndefined()
    expect(resolved.actions).toEqual(recovered.actions)
    expect(rows.get(projectPath)?.state.pending).toBeNull()
  })

  it('shares required profile metadata with setup but does not share unrelated private definitions', async () => {
    const initial = await catalog.read(scope())
    const profile = await catalog.edit(scope(), initial.revision, {
      type: 'save-profile',
      definition: { id: 'frontend', name: 'Frontend' },
      storage: 'local',
    })
    const personal = await catalog.edit(scope(), profile.revision, {
      type: 'save-preparation',
      definition: { ...setup, profileId: 'frontend' },
      storage: 'local',
    })
    const published = await catalog.edit(scope(), personal.revision, {
      type: 'move-definition',
      collection: 'preparation',
      id: setup.id,
      storage: 'project',
    })
    expect(published.preparation[0]).toMatchObject({ source: 'project', review: 'enabled' })
    expect(published.profiles.find(({ definition }) => definition.id === 'frontend')?.source).toBe(
      'override',
    )
    await expect(
      catalog.edit(scope(), published.revision, {
        type: 'move-definition',
        collection: 'profiles',
        id: 'frontend',
        storage: 'local',
      }),
    ).rejects.toThrow('Shared preparation requires a shared profile')
  })
})
