import type { BrowserImportResult } from '@shared/types/browser-import'
import type { BrowserProfile } from '@shared/types/browser-profile'
import { describe, expect, it, vi } from 'vitest'
import { BrowserImportError } from '../browser-import-errors'
import { createGuidedBrowserImporter } from '../guided-browser-import'

const imported: BrowserImportResult = { imported: 3, skipped: 1, skippedDomains: ['blocked.test'] }
const existingProfile: BrowserProfile = { id: 'work', name: 'Work', kind: 'persistent' }

function fixture(initialProfiles: readonly BrowserProfile[] = [existingProfile]) {
  let profiles = [...initialProfiles]
  const events: string[] = []
  const updateConfiguredProfiles = vi.fn(async (next: readonly BrowserProfile[]) => {
    events.push('save')
    profiles = [...next]
  })
  const importCookiesIntoPreparedProfile = vi.fn(
    async (_input: unknown, target: BrowserProfile) => {
      events.push(`import:${target.id}`)
      return imported
    },
  )
  const clearProfileData = vi.fn(async (profileId: string) => {
    events.push(`clear:${profileId}`)
  })
  const importer = createGuidedBrowserImporter({
    getConfiguredProfiles: () => profiles,
    updateConfiguredProfiles,
    importCookiesIntoPreparedProfile,
    clearProfileData,
  })
  return {
    clearProfileData,
    events,
    importCookiesIntoPreparedProfile,
    importer,
    profiles: () => profiles,
    setProfiles: (next: readonly BrowserProfile[]) => {
      profiles = [...next]
    },
    updateConfiguredProfiles,
  }
}

const source = {
  sourceId: 'chrome',
  sourceProfileDirectory: 'Default',
} as const

describe('guided browser cookie import', () => {
  it('fails closed when current profile settings cannot be read', async () => {
    const importCookiesIntoPreparedProfile = vi.fn(async () => imported)
    const importer = createGuidedBrowserImporter({
      getConfiguredProfiles: async () => {
        throw new Error('settings unavailable')
      },
      updateConfiguredProfiles: vi.fn(),
      importCookiesIntoPreparedProfile,
      clearProfileData: vi.fn(),
    })

    await expect(
      importer.importCookies({ ...source, target: { kind: 'new', profileId: 'profile-new' } }),
    ).resolves.toMatchObject({ ok: false, reason: 'read-failed' })
    expect(importCookiesIntoPreparedProfile).not.toHaveBeenCalled()
  })

  it('imports into an existing persistent profile without rewriting settings', async () => {
    const test = fixture()

    await expect(
      test.importer.importCookies({ ...source, target: { kind: 'existing', profileId: 'work' } }),
    ).resolves.toEqual({
      ok: true,
      result: imported,
      targetName: 'Work',
      createdProfile: null,
    })
    expect(test.updateConfiguredProfiles).not.toHaveBeenCalled()
    expect(test.clearProfileData).not.toHaveBeenCalled()
  })

  it('publishes a new profile only after cookies have been imported', async () => {
    const test = fixture([{ id: 'first', name: 'Chrome', kind: 'persistent' }])

    await expect(
      test.importer.importCookies({
        ...source,
        target: { kind: 'new', profileId: 'profile-stable' },
      }),
    ).resolves.toMatchObject({
      ok: true,
      targetName: 'Chrome 2',
      createdProfile: { id: 'profile-stable', name: 'Chrome 2', kind: 'persistent' },
    })
    expect(test.events).toEqual(['import:profile-stable', 'save'])
    expect(test.profiles()).toContainEqual({
      id: 'profile-stable',
      name: 'Chrome 2',
      kind: 'persistent',
    })
  })

  it('does not publish a new profile when no cookies were imported', async () => {
    const test = fixture([])
    test.importCookiesIntoPreparedProfile.mockResolvedValueOnce({
      imported: 0,
      skipped: 0,
      skippedDomains: [],
    })

    await expect(
      test.importer.importCookies({
        ...source,
        target: { kind: 'new', profileId: 'profile-empty' },
      }),
    ).resolves.toMatchObject({ ok: true, createdProfile: null })
    expect(test.profiles()).toEqual([])
    expect(test.updateConfiguredProfiles).not.toHaveBeenCalled()
  })

  it('keeps one stable target id usable across a blocked retry', async () => {
    const test = fixture([])
    test.importCookiesIntoPreparedProfile
      .mockRejectedValueOnce(new BrowserImportError('needs-keychain-approval', 'approval needed'))
      .mockResolvedValueOnce(imported)
    const input = { ...source, target: { kind: 'new', profileId: 'profile-stable' } } as const

    await expect(test.importer.importCookies(input)).resolves.toMatchObject({
      ok: false,
      reason: 'needs-keychain-approval',
    })
    expect(test.profiles()).toEqual([])
    await expect(test.importer.importCookies(input)).resolves.toMatchObject({
      ok: true,
      createdProfile: { id: 'profile-stable' },
    })
    expect(test.importCookiesIntoPreparedProfile.mock.calls.map((call) => call[1].id)).toEqual([
      'profile-stable',
      'profile-stable',
    ])
  })

  it('clears imported data if the profile cap is reached while import runs', async () => {
    const test = fixture([])
    test.importCookiesIntoPreparedProfile.mockImplementationOnce(async () => {
      test.setProfiles(
        Array.from({ length: 24 }, (_, index) => ({
          id: `other-${String(index)}`,
          name: `Other ${String(index)}`,
          kind: 'persistent',
        })),
      )
      return imported
    })

    await expect(
      test.importer.importCookies({
        ...source,
        target: { kind: 'new', profileId: 'profile-over-limit' },
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'profile-limit-reached' })
    expect(test.clearProfileData).toHaveBeenCalledExactlyOnceWith('profile-over-limit')
    expect(test.updateConfiguredProfiles).not.toHaveBeenCalled()
  })

  it('clears imported data when settings persistence rejects', async () => {
    const test = fixture([])
    test.updateConfiguredProfiles.mockRejectedValueOnce(new Error('disk full'))

    await expect(
      test.importer.importCookies({
        ...source,
        target: { kind: 'new', profileId: 'profile-unsaved' },
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'profile-not-saved' })
    expect(test.clearProfileData).toHaveBeenCalledExactlyOnceWith('profile-unsaved')
  })

  it('surfaces cleanup failure distinctly so an orphaned partition is not hidden', async () => {
    const test = fixture([])
    test.updateConfiguredProfiles.mockRejectedValueOnce(new Error('disk full'))
    test.clearProfileData.mockRejectedValueOnce(new Error('partition busy'))

    await expect(
      test.importer.importCookies({
        ...source,
        target: { kind: 'new', profileId: 'profile-orphan' },
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'profile-cleanup-failed' })
  })

  it('clears an existing target that disappears before finalization', async () => {
    const test = fixture()
    test.importCookiesIntoPreparedProfile.mockImplementationOnce(async () => {
      test.setProfiles([])
      return imported
    })

    await expect(
      test.importer.importCookies({ ...source, target: { kind: 'existing', profileId: 'work' } }),
    ).resolves.toMatchObject({ ok: false, reason: 'unknown-target-profile' })
    expect(test.clearProfileData).toHaveBeenCalledExactlyOnceWith('work')
  })

  it('treats an already-published stable new id as an existing retry target', async () => {
    const test = fixture([{ id: 'profile-stable', name: 'Chrome', kind: 'persistent' }])

    await expect(
      test.importer.importCookies({
        ...source,
        target: { kind: 'new', profileId: 'profile-stable' },
      }),
    ).resolves.toMatchObject({ ok: true, targetName: 'Chrome', createdProfile: null })
    expect(test.updateConfiguredProfiles).not.toHaveBeenCalled()
  })
})
