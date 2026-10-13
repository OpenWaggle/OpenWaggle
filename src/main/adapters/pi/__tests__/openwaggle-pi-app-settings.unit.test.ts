import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { describe, expect, it } from 'vitest'
import { openWagglePiAppSettingsFrom } from '../openwaggle-pi-app-settings'

function settings(overrides: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides }
}

describe('the OpenWaggle settings handed to Pi', () => {
  it("reads the user's Pi values again for settings never chosen in OpenWaggle", () => {
    let piUser: { readonly cacheWarming?: 'idle' | 'off'; readonly codemodeEnabled?: boolean } = {
      cacheWarming: 'idle',
      codemodeEnabled: false,
    }
    // Loaded while Pi said idle and no codemode.
    const loaded = settings({ cacheWarming: 'idle', codemodeEnabled: false })

    expect(openWagglePiAppSettingsFrom(loaded, () => piUser)).toEqual({
      cacheWarming: 'idle',
      codemodeEnabled: false,
    })

    // The user changes their Pi settings while OpenWaggle runs.
    piUser = { cacheWarming: 'off' }
    expect(openWagglePiAppSettingsFrom(loaded, () => piUser)).toEqual({
      cacheWarming: 'off',
      codemodeEnabled: true,
    })
  })

  it('keeps what the user chose in OpenWaggle, whatever the Pi settings say', () => {
    const chosen = settings({
      cacheWarming: 'streaming',
      codemodeEnabled: true,
      piRuntimeSettingsChosen: { cacheWarming: true, codemodeEnabled: true },
    })

    expect(
      openWagglePiAppSettingsFrom(chosen, () => ({ cacheWarming: 'idle', codemodeEnabled: false })),
    ).toEqual({ cacheWarming: 'streaming', codemodeEnabled: true })
  })
})
