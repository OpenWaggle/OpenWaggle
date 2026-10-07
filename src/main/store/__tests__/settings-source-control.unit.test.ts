import { describe, expect, it } from 'vitest'
import {
  installSettingsStoreTestLifecycle,
  loadSettingsModule,
  writeRawSetting,
} from './settings-test-harness'

describe('source-control settings', () => {
  installSettingsStoreTestLifecycle()

  it('defaults to no choices, so detection and the inspector default apply', async () => {
    const { getSettings } = await loadSettingsModule()
    const settings = getSettings()

    expect(settings.changeRequestOpenDestination).toBeNull()
    expect(settings.changeRequestOpenDestinationByProject).toEqual({})
    expect(settings.sourceControlHostProviders).toEqual({})
    expect(settings.sourceControlDetectedHostProviders).toEqual({})
    expect(settings.sourceControlRepositoryAccounts).toEqual({})
    expect(settings.sourceControlChangeRequestRepositories).toEqual({})
    expect(settings.sourceControlProjectDeclarations).toEqual({})
  })

  it('persists every source-control choice durably', async () => {
    const settings = await loadSettingsModule()

    await settings.updateSettingsDurably({
      changeRequestOpenDestination: 'website',
      changeRequestOpenDestinationByProject: { '/work/acme': 'inspector' },
      sourceControlHostProviders: { 'git.acme.io': 'gitlab' },
      sourceControlDetectedHostProviders: { 'code.acme.io': 'github' },
      sourceControlRepositoryAccounts: { 'github.com/acme/app': 'jdoe_acme' },
      sourceControlChangeRequestRepositories: { 'github.com/jdoe/app': 'github.com/acme/app' },
      sourceControlProjectDeclarations: {
        '/work/acme': { approved: { 'git.acme.io': 'gitlab' }, declined: {} },
      },
    })
    await settings.refreshSettingsStore()

    expect(settings.getSettings()).toMatchObject({
      changeRequestOpenDestination: 'website',
      changeRequestOpenDestinationByProject: { '/work/acme': 'inspector' },
      sourceControlHostProviders: { 'git.acme.io': 'gitlab' },
      sourceControlDetectedHostProviders: { 'code.acme.io': 'github' },
      sourceControlRepositoryAccounts: { 'github.com/acme/app': 'jdoe_acme' },
      sourceControlChangeRequestRepositories: { 'github.com/jdoe/app': 'github.com/acme/app' },
      sourceControlProjectDeclarations: {
        '/work/acme': { approved: { 'git.acme.io': 'gitlab' }, declined: {} },
      },
    })
  })

  it('clears the user-wide destination back to unchosen', async () => {
    const settings = await loadSettingsModule()
    await settings.updateSettingsDurably({ changeRequestOpenDestination: 'website' })
    await settings.updateSettingsDurably({ changeRequestOpenDestination: null })
    await settings.refreshSettingsStore()

    expect(settings.getSettings().changeRequestOpenDestination).toBeNull()
  })

  it('fails closed on a host provider keyed by a non-canonical host', async () => {
    await writeRawSetting('sourceControlHostProviders', { 'Git.Acme.IO': 'gitlab' })
    const { getSettings } = await loadSettingsModule()

    expect(() => getSettings()).toThrow(/Saved settings are invalid.*sourceControlHostProviders/u)
  })

  it('fails closed on an unknown provider', async () => {
    await writeRawSetting('sourceControlDetectedHostProviders', { 'git.acme.io': 'bitbucket' })
    const { getSettings } = await loadSettingsModule()

    expect(() => getSettings()).toThrow(/Saved settings are invalid/u)
  })
})
