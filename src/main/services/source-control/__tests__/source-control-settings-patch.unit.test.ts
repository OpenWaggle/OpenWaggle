import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { SOURCE_CONTROL_SETTINGS_RECORD_LIMIT } from '@shared/types/source-control'
import { describe, expect, it, vi } from 'vitest'
import {
  applySourceControlSettingsPatch,
  createSerialSourceControlSettingsAccess,
} from '../source-control-settings-patch'

describe('changing source-control settings one entry at a time', () => {
  it('sets and removes single entries without touching the others', () => {
    const next = applySourceControlSettingsPatch(
      {
        ...DEFAULT_SETTINGS,
        sourceControlHostProviders: { 'a.io': 'github', 'b.io': 'gitlab' },
      },
      { sourceControlHostProviders: { 'b.io': null, 'c.io': 'unsupported' } },
    )

    expect(next).toEqual({
      sourceControlHostProviders: { 'a.io': 'github', 'c.io': 'unsupported' },
    })
  })

  it('drops the oldest entries once a record is full', () => {
    const full = Object.fromEntries(
      Array.from({ length: SOURCE_CONTROL_SETTINGS_RECORD_LIMIT }, (_, index) => [
        `repo-${index}`,
        'octo',
      ]),
    )
    const next = applySourceControlSettingsPatch(
      { ...DEFAULT_SETTINGS, sourceControlRepositoryAccounts: full },
      { sourceControlRepositoryAccounts: { newest: 'octo' } },
    )
    const accounts = next.sourceControlRepositoryAccounts ?? {}

    expect(Object.keys(accounts)).toHaveLength(SOURCE_CONTROL_SETTINGS_RECORD_LIMIT)
    expect(accounts['repo-0']).toBeUndefined()
    expect(accounts.newest).toBe('octo')
  })

  it('keeps every entry when two writers patch at the same time', async () => {
    let stored = { ...DEFAULT_SETTINGS }
    const access = createSerialSourceControlSettingsAccess({
      read: async () => stored,
      update: async (partial) => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        stored = { ...stored, ...partial }
      },
    })

    await Promise.all([
      access.patch({ sourceControlDetectedHostProviders: { 'a.io': 'github' } }),
      access.patch({ sourceControlDetectedHostProviders: { 'b.io': 'gitlab' } }),
    ])

    expect(stored.sourceControlDetectedHostProviders).toEqual({
      'a.io': 'github',
      'b.io': 'gitlab',
    })
  })

  it('refuses a patch that stored Settings could not read back', async () => {
    let stored = { ...DEFAULT_SETTINGS }
    const update = vi.fn(async (partial: Partial<typeof stored>) => {
      stored = { ...stored, ...partial }
    })
    const access = createSerialSourceControlSettingsAccess({ read: async () => stored, update })

    await expect(
      access.patch({ sourceControlRepositoryAccounts: { ['x'.repeat(600)]: 'octo' } }),
    ).rejects.toThrow()
    await expect(
      access.patch({ sourceControlDetectedHostProviders: { 'not a host': 'github' } }),
    ).rejects.toThrow()
    expect(update).not.toHaveBeenCalled()
  })
})
