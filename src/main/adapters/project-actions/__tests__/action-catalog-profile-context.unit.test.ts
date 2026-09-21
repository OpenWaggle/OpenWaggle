import type { PreparationProfile } from '@shared/types/action-definitions'
import { describe, expect, it } from 'vitest'
import { EMPTY_ACTION_MANIFEST } from '../../../domain/project-action-catalog'
import {
  catalog,
  installActionCatalogFixture,
  projectPath,
  rows,
  scope,
  setup,
  shared,
} from './action-catalog.test-harness'

installActionCatalogFixture()

const profile: PreparationProfile = { id: 'frontend', name: 'Frontend' }
const definition = { ...setup, profileId: profile.id }

describe('private preparation profile context', () => {
  it.each(['save', 'move'] as const)(
    'retains the shared profile when preparation is made private through %s',
    async (operation) => {
      await shared({
        ...EMPTY_ACTION_MANIFEST,
        profiles: [profile],
        preparation: [definition],
      })
      const initial = await catalog.read(scope())
      await catalog.edit(
        scope(),
        initial.revision,
        operation === 'save'
          ? { type: 'save-preparation', definition, storage: 'local' }
          : {
              type: 'move-definition',
              collection: 'preparation',
              id: definition.id,
              storage: 'local',
            },
      )
      await shared(EMPTY_ACTION_MANIFEST)

      const retained = await catalog.read(scope())
      expect(retained.profiles).toContainEqual({ definition: profile, source: 'local' })
      expect(retained.preparation).toHaveLength(1)
      expect(retained.preparation[0]).toMatchObject({ definition, source: 'local' })
      expect(rows.get(projectPath)?.state.document.manifest.profiles).toEqual([profile])
      const removed = await catalog.edit(scope(), retained.revision, {
        type: 'delete-preparation',
        id: definition.id,
        storage: 'local',
      })
      expect(removed.preparation).toEqual([])
    },
  )

  it.each(['save', 'move'] as const)(
    'retains profile context for private preparation when the profile is shared through %s',
    async (operation) => {
      const initial = await catalog.read(scope())
      const profiled = await catalog.edit(scope(), initial.revision, {
        type: 'save-profile',
        definition: profile,
        storage: 'local',
      })
      const prepared = await catalog.edit(scope(), profiled.revision, {
        type: 'save-preparation',
        definition,
        storage: 'local',
      })
      await catalog.edit(
        scope(),
        prepared.revision,
        operation === 'save'
          ? { type: 'save-profile', definition: profile, storage: 'project' }
          : {
              type: 'move-definition',
              collection: 'profiles',
              id: profile.id,
              storage: 'project',
            },
      )
      await shared(EMPTY_ACTION_MANIFEST)

      const retained = await catalog.read(scope())
      expect(retained.profiles).toContainEqual({ definition: profile, source: 'local' })
      expect(retained.preparation[0]).toMatchObject({ definition, review: 'enabled' })
      expect(rows.get(projectPath)?.state.document.manifest.profiles).toEqual([profile])
    },
  )

  it('keeps the implicit default profile implicit for private preparation', async () => {
    const initial = await catalog.read(scope())
    await catalog.edit(scope(), initial.revision, {
      type: 'save-preparation',
      definition: setup,
      storage: 'local',
    })
    expect(rows.get(projectPath)?.state.document.manifest.profiles).toEqual([])
  })
})
