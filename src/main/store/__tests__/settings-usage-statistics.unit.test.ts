import type { Settings } from '@shared/types/settings'
import { afterEach, describe, expect, it } from 'vitest'
import { setAppDatabaseAccessMode } from '../../services/database-access-mode'
import {
  installSettingsStoreTestLifecycle,
  loadSettingsModule,
  writeRawSetting,
} from './settings-test-harness'

/** Subscribes to the store and returns every authoritative `usageStatisticsEnabled` it saw. */
async function watchAuthoritativeSetting() {
  const { onAuthoritativeSettingsChange } = await import('../authoritative-settings')
  const values: (boolean | undefined)[] = []
  const unsubscribe = onAuthoritativeSettingsChange((settings: Settings | undefined) => {
    values.push(settings?.usageStatisticsEnabled)
  })
  return { values, unsubscribe }
}

describe('usageStatisticsEnabled setting', () => {
  installSettingsStoreTestLifecycle()

  afterEach(() => {
    setAppDatabaseAccessMode('owner')
  })

  it('defaults to on and publishes the loaded value as authoritative', async () => {
    const watched = await watchAuthoritativeSetting()
    const { getSettings } = await loadSettingsModule()

    expect(getSettings().usageStatisticsEnabled).toBe(true)
    expect(watched.values).toEqual([undefined, true])
    watched.unsubscribe()
  })

  it('loads a saved opt-out and publishes it', async () => {
    await writeRawSetting('usageStatisticsEnabled', false)
    const watched = await watchAuthoritativeSetting()

    const { getSettings } = await loadSettingsModule()

    expect(getSettings().usageStatisticsEnabled).toBe(false)
    expect(watched.values.at(-1)).toBe(false)
    watched.unsubscribe()
  })

  it('fails closed on an invalid saved value and publishes no Settings', async () => {
    await writeRawSetting('usageStatisticsEnabled', 'off')
    const watched = await watchAuthoritativeSetting()

    const { getSettings } = await loadSettingsModule()

    expect(() => getSettings()).toThrow(/Saved settings are invalid.*usageStatisticsEnabled/u)
    expect(watched.values.at(-1)).toBeUndefined()
    watched.unsubscribe()
  })

  it('persists a durable opt-out and publishes it', async () => {
    const settings = await loadSettingsModule()
    const watched = await watchAuthoritativeSetting()

    await settings.updateSettingsDurably({ usageStatisticsEnabled: false })
    await settings.refreshSettingsStore()

    expect(settings.getSettings().usageStatisticsEnabled).toBe(false)
    expect(watched.values.at(-1)).toBe(false)
    watched.unsubscribe()
  })

  it('in an attached GUI, publishes nothing from its own database, only the Host snapshot', async () => {
    // The attached GUI's database is an empty in-memory one whose default reads as on.
    setAppDatabaseAccessMode('client-isolated')
    const watched = await watchAuthoritativeSetting()
    const settings = await loadSettingsModule()

    expect(settings.getSettings().usageStatisticsEnabled).toBe(true)
    expect(watched.values.every((value) => value === undefined)).toBe(true)

    // The Host says the user turned statistics off.
    settings.hydrateSettingsStoreFromHost({
      ...settings.getSettings(),
      usageStatisticsEnabled: false,
    })
    expect(watched.values.at(-1)).toBe(false)

    // A local change to the isolated database does not override the Host snapshot.
    settings.updateSettings({ usageStatisticsEnabled: true })
    expect(watched.values.at(-1)).toBe(false)

    settings.hydrateSettingsStoreFromHost({
      ...settings.getSettings(),
      usageStatisticsEnabled: true,
    })
    expect(watched.values.at(-1)).toBe(true)
    watched.unsubscribe()
  })
})
