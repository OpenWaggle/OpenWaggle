import { safeDecodeUnknown } from '@shared/schema'
import {
  browserImportInputSchema,
  guidedBrowserImportInputSchema,
} from '@shared/schemas/browser-import'
import { browserProfileSchema } from '@shared/schemas/browser-profile'
import {
  DEFAULT_BROWSER_PROFILE_ID,
  INCOGNITO_BROWSER_PROFILE_ID,
  resolveBrowserProfiles,
} from '@shared/types/browser-profile'
import { describe, expect, it } from 'vitest'

describe('browser profile contract', () => {
  it('synthesizes fixed built-ins before custom persistent profiles', () => {
    expect(
      resolveBrowserProfiles([
        { id: 'work', name: 'Work', kind: 'persistent' },
        { id: DEFAULT_BROWSER_PROFILE_ID, name: 'Spoofed', kind: 'persistent' },
      ]),
    ).toEqual([
      { id: DEFAULT_BROWSER_PROFILE_ID, name: 'Default', kind: 'persistent' },
      { id: INCOGNITO_BROWSER_PROFILE_ID, name: 'Incognito', kind: 'incognito' },
      { id: 'work', name: 'Work', kind: 'persistent' },
    ])
  })

  it('normalizes custom incognito declarations to persistent profiles', () => {
    expect(
      resolveBrowserProfiles([{ id: 'work', name: 'Work', kind: 'incognito' }]),
    ).toContainEqual({ id: 'work', name: 'Work', kind: 'persistent' })
  })

  it('rejects control characters and whitespace ambiguity at the boundary', () => {
    expect(
      safeDecodeUnknown(browserProfileSchema, {
        id: 'work\u0000personal',
        name: 'Work',
        kind: 'persistent',
      }).success,
    ).toBe(false)
    expect(
      safeDecodeUnknown(browserProfileSchema, {
        id: ' work ',
        name: 'Work',
        kind: 'persistent',
      }).success,
    ).toBe(false)
  })

  it('decodes a bounded browser import request', () => {
    expect(
      safeDecodeUnknown(browserImportInputSchema, {
        sourceId: 'firefox',
        sourceProfileDirectory: 'Profiles/default-release',
        targetProfileId: 'work',
      }),
    ).toMatchObject({ success: true })
    expect(
      safeDecodeUnknown(browserImportInputSchema, {
        sourceId: 'unknown',
        sourceProfileDirectory: '../Secrets',
        targetProfileId: 'work',
      }).success,
    ).toBe(false)
  })

  it('decodes both guided import target modes and rejects malformed destinations', () => {
    const source = {
      sourceId: 'safari',
      sourceProfileDirectory: 'Default',
    }
    expect(
      safeDecodeUnknown(guidedBrowserImportInputSchema, {
        ...source,
        target: { kind: 'new', profileId: 'profile-stable' },
      }),
    ).toMatchObject({ success: true })
    expect(
      safeDecodeUnknown(guidedBrowserImportInputSchema, {
        ...source,
        target: { kind: 'existing', profileId: 'work' },
      }),
    ).toMatchObject({ success: true })
    expect(
      safeDecodeUnknown(guidedBrowserImportInputSchema, {
        ...source,
        target: { kind: 'temporary', profileId: 'incognito' },
      }).success,
    ).toBe(false)
  })
})
