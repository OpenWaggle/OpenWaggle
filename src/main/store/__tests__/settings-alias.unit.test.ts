import { describe, expect, it } from 'vitest'
import { installSettingsStoreTestLifecycle, loadSettingsModule } from './settings-test-harness'

describe('settings store project path aliases', () => {
  installSettingsStoreTestLifecycle()

  it('records, resolves, and deletes project path aliases durably', async () => {
    const { getSettings, initializeSettingsStore, resetSettingsStoreForTests } =
      await loadSettingsModule()
    const { deleteProjectPathAliasDurably, lookupProjectPathAlias, recordProjectPathAliasDurably } =
      await import('../settings/project-path-alias-writers')

    await recordProjectPathAliasDurably('/tmp/alias-link', '/tmp/alias-target')
    // A same-path record is a no-op, not an alias entry.
    await recordProjectPathAliasDurably('/tmp/same', '/tmp/same')
    expect(await lookupProjectPathAlias('/tmp/alias-link')).toBe('/tmp/alias-target')
    expect(await lookupProjectPathAlias('/tmp/same')).toBeUndefined()
    // A retargeted symlink must not silently re-point a saved reference's identity.
    await recordProjectPathAliasDurably('/tmp/alias-link', '/tmp/other-target')
    expect(await lookupProjectPathAlias('/tmp/alias-link')).toBe('/tmp/alias-target')

    await resetSettingsStoreForTests()
    await initializeSettingsStore()

    expect(getSettings().projectPathAliases).toEqual({
      '/tmp/alias-link': '/tmp/alias-target',
    })

    await deleteProjectPathAliasDurably('/tmp/alias-link')
    expect(await lookupProjectPathAlias('/tmp/alias-link')).toBeUndefined()
  })
})
