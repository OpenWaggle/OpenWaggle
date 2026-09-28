import { describe, expect, it } from 'vitest'
import { EMPTY_ACTION_MANIFEST } from '../../../domain/project-action-catalog'
import {
  action,
  catalog,
  installActionCatalogFixture,
  scope,
  setup,
  shared,
} from './action-catalog.test-harness'

installActionCatalogFixture()

describe('guided action panel catalog rules (ADR 0038)', () => {
  it('rejects saving a second action whose name differs only by letter case or spacing', async () => {
    const empty = await catalog.read(scope())
    const saved = await catalog.edit(scope(), empty.revision, {
      type: 'save-action',
      definition: action,
      storage: 'local',
    })
    await expect(
      catalog.edit(scope(), saved.revision, {
        type: 'save-action',
        definition: { ...action, id: 'second', name: '  test ' },
        storage: 'project',
      }),
    ).rejects.toThrow('You already have an action called “Test”')
  })

  it('lets an action keep its own name, including as a Local definition override', async () => {
    await shared({ ...EMPTY_ACTION_MANIFEST, actions: [action] })
    const discovered = await catalog.read(scope())
    const overridden = await catalog.edit(scope(), discovered.revision, {
      type: 'save-action',
      definition: { ...action, invocation: { ...action.invocation, directory: 'packages/app' } },
      storage: 'local',
    })
    expect(overridden.actions).toEqual([
      expect.objectContaining({ source: 'override', definition: expect.objectContaining({ name: 'Test' }) }),
    ])
  })

  it('keeps loading existing duplicate names and only rejects a save that keeps the clash', async () => {
    const duplicate = { ...action, id: 'teammate-test' }
    await shared({ ...EMPTY_ACTION_MANIFEST, actions: [action, duplicate] })
    const loaded = await catalog.read(scope())
    expect(loaded.actions.map(({ definition }) => definition.id)).toEqual(['test', 'teammate-test'])
    await expect(
      catalog.edit(scope(), loaded.revision, {
        type: 'save-action',
        definition: { ...duplicate, icon: 'play' },
        storage: 'project',
      }),
    ).rejects.toThrow('You already have an action called “Test”')
    const renamed = await catalog.edit(scope(), loaded.revision, {
      type: 'save-action',
      definition: { ...duplicate, name: 'Test (teammate)' },
      storage: 'project',
    })
    expect(renamed.actions.map(({ definition }) => definition.name)).toEqual([
      'Test',
      'Test (teammate)',
    ])
  })

  it('turns a shared setup on for the person who saved it, for exactly that execution', async () => {
    const empty = await catalog.read(scope())
    const saved = await catalog.edit(scope(), empty.revision, {
      type: 'save-preparation',
      definition: setup,
      storage: 'project',
    })
    expect(saved.preparation[0]).toMatchObject({ source: 'project', review: 'enabled' })
    await shared({
      ...EMPTY_ACTION_MANIFEST,
      preparation: [
        { ...setup, invocation: { type: 'command', command: 'pnpm install --frozen-lockfile', directory: '.' } },
      ],
    })
    const changed = await catalog.read(scope())
    expect(changed.preparation[0]?.review).toBe('required')
  })
})
