import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { DEFAULT_SHORTCUT_BINDINGS } from '@shared/types/shortcuts'
import { describe, expect, it } from 'vitest'
import {
  dropSettingsStoreForFailureTest,
  installSettingsStoreTestLifecycle,
  loadSettingsModule,
  readRemovedPersistenceNames,
  readTableColumns,
  seedRemovedPersistenceForCleanup,
  writeRawSetting,
  writeRawSettingJson,
} from './settings-test-harness'

describe('settings store loading', () => {
  installSettingsStoreTestLifecycle()

  it('drops removed pre-Pi persistence tables and settings keys during database bootstrap', async () => {
    await seedRemovedPersistenceForCleanup()

    const removedPersistence = await readRemovedPersistenceNames()

    expect(removedPersistence).toEqual({
      tables: [],
      settingsKeys: [],
    })
  })

  it('normalizes the current Pi-native session schema during database bootstrap', async () => {
    await seedRemovedPersistenceForCleanup()

    await expect(readTableColumns('sessions')).resolves.toEqual(
      expect.arrayContaining(['pi_session_id', 'last_active_branch_id']),
    )
    await expect(readTableColumns('session_branches')).resolves.toEqual(
      expect.arrayContaining(['archived_at']),
    )
    await expect(readTableColumns('session_tree_ui_state')).resolves.toEqual(
      expect.arrayContaining(['expanded_node_ids_touched']),
    )
  })

  it('uses defaults only after a successful read confirms that no settings are stored', async () => {
    const { getSettings } = await loadSettingsModule()

    expect(getSettings()).toMatchObject({
      projectPath: null,
      browserLinkTarget: 'system',
      thinkingLevel: 'medium',
    })
  })

  it('accepts the explicit legacy diff-wrap and pre-terminal-palette formats', async () => {
    await writeRawSetting('diffWrapLines', 'true')
    await writeRawSetting('appearancePreferences', {
      typography: DEFAULT_SETTINGS.appearancePreferences.typography,
      motion: DEFAULT_SETTINGS.appearancePreferences.motion,
    })

    const { getSettings } = await loadSettingsModule()

    expect(getSettings()).toMatchObject({
      diffWrapLines: true,
      appearancePreferences: {
        terminalPalette: DEFAULT_SETTINGS.appearancePreferences.terminalPalette,
      },
    })
  })

  it('fails closed when a present current setting has an invalid value', async () => {
    await writeRawSetting('thinkingLevel', 'ultra')

    const { getSettings } = await loadSettingsModule()

    expect(() => getSettings()).toThrow(/Saved settings are invalid.*thinkingLevel/u)
  })

  it('loads pre-terminal shortcut bindings without losing custom shortcuts', async () => {
    await writeRawSetting('shortcutBindings', {
      'commandPalette.toggle': { key: 'K', mod: true },
      'filePicker.toggle': { key: 'P', mod: true },
      'chat.new': { key: 'N', mod: true },
      'terminal.toggle': { key: 'J', mod: true },
      'sidebar.toggle': { key: 'B', mod: true },
      'diff.toggle': { key: 'G', mod: true },
      'sessionTree.toggle': { key: 'Y', mod: true, shift: true },
      'request.focus': { key: 'A', mod: true, shift: true },
    })

    const { getSettings } = await loadSettingsModule()

    expect(getSettings().shortcutBindings['diff.toggle']).toEqual({ key: 'G', mod: true })
    expect(getSettings().shortcutBindings['terminal.new']).toEqual(
      DEFAULT_SHORTCUT_BINDINGS['terminal.new'],
    )
  })

  it('still rejects malformed bindings in an older shortcut map', async () => {
    await writeRawSetting('shortcutBindings', { 'terminal.toggle': { key: 42 } })
    const { getSettings } = await loadSettingsModule()
    expect(() => getSettings()).toThrow(/shortcutBindings/u)
  })

  it('fails closed on conflicting persisted shortcut bindings', async () => {
    await writeRawSetting('shortcutBindings', {
      ...DEFAULT_SHORTCUT_BINDINGS,
      'commandPalette.toggle': { key: 'P', mod: true },
      'filePicker.toggle': { key: 'P', mod: true },
    })

    const { getSettings } = await loadSettingsModule()

    expect(() => getSettings()).toThrow(/Shortcut Mod\+P is already assigned/u)
  })

  it('fails closed on malformed persisted JSON', async () => {
    await writeRawSettingJson('browserLinkTarget', '{not-json')

    const { getSettings } = await loadSettingsModule()

    expect(() => getSettings()).toThrow(/browserLinkTarget.*not valid JSON/u)
  })

  it('ignores malformed JSON in unknown retired setting rows', async () => {
    await writeRawSettingJson('retiredSettingFromOldRelease', '{not-json')

    const { getSettings } = await loadSettingsModule()

    expect(getSettings().browserLinkTarget).toBe('system')
  })

  it.each([
    ['browserLinkTarget', 'embedded'],
    [
      'browserProfiles',
      [{ id: 'default', name: 'Conflicting default', kind: 'persistent' as const }],
    ],
    ['browserDefaultViewport', { mode: 'fixed', width: 10, height: 10, presetId: null }],
    ['browserDefaultProfileId', 'missing-profile'],
  ])('fails closed on an invalid persisted %s setting', async (key, value) => {
    await writeRawSetting(key, value)

    const { getSettings } = await loadSettingsModule()

    expect(() => getSettings()).toThrow()
  })

  it('fails closed instead of clamping an out-of-range terminal preference', async () => {
    await writeRawSetting('appearancePreferences', {
      ...DEFAULT_SETTINGS.appearancePreferences,
      typography: {
        ...DEFAULT_SETTINGS.appearancePreferences.typography,
        terminalFontSize: 999,
      },
    })

    const { getSettings } = await loadSettingsModule()

    expect(() => getSettings()).toThrow(/terminalFontSize/u)
  })

  it('surfaces SQLite query failures instead of publishing defaults', async () => {
    await dropSettingsStoreForFailureTest()

    const { getSettings } = await loadSettingsModule()

    expect(() => getSettings()).toThrow(/could not read the saved settings database/u)
  })

  it('retries the underlying read and publishes saved settings only after recovery', async () => {
    await writeRawSettingJson('browserLinkTarget', '{not-json')
    const settingsModule = await loadSettingsModule()
    expect(() => settingsModule.getSettings()).toThrow(/not valid JSON/u)

    await writeRawSetting('browserLinkTarget', 'app')
    await settingsModule.initializeSettingsStore()

    expect(settingsModule.getSettings().browserLinkTarget).toBe('app')
  })

  it('blocks writes while the saved settings snapshot is unreadable', async () => {
    await writeRawSetting('thinkingLevel', 'ultra')
    const settingsModule = await loadSettingsModule()

    expect(() => settingsModule.updateSettings({ thinkingLevel: 'high' })).toThrow(
      /Saved settings are invalid/u,
    )
    await writeRawSetting('thinkingLevel', 'low')
    await settingsModule.initializeSettingsStore()

    expect(settingsModule.getSettings().thinkingLevel).toBe('low')
  })
})
