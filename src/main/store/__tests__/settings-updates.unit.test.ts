import { SupportedModelId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import {
  dropSettingsStoreForFailureTest,
  installSettingsStoreTestLifecycle,
  loadSettingsModule,
  writeRawSetting,
} from './settings-test-harness'

describe('settings store updates', () => {
  installSettingsStoreTestLifecycle()

  it('sanitizes and limits recent projects from persisted settings', async () => {
    await writeRawSetting('recentProjects', [
      '/tmp/repo-1',
      '/tmp/repo-1',
      '   /tmp/repo-2   ',
      '/tmp/repo-3',
      '/tmp/repo-4',
      '/tmp/repo-5',
      '/tmp/repo-6',
      '/tmp/repo-7',
      '/tmp/repo-8',
      '/tmp/repo-9',
      '/tmp/repo-10',
      '/tmp/repo-11',
    ])

    const { getSettings } = await loadSettingsModule()
    const settings = getSettings()

    expect(settings.recentProjects).toEqual([
      '/tmp/repo-1',
      '/tmp/repo-2',
      '/tmp/repo-3',
      '/tmp/repo-4',
      '/tmp/repo-5',
      '/tmp/repo-6',
      '/tmp/repo-7',
      '/tmp/repo-8',
      '/tmp/repo-9',
      '/tmp/repo-10',
    ])
  })

  it('sanitizes and limits favorite models from persisted settings', async () => {
    await writeRawSetting('favoriteModels', [
      'openai/gpt-4.1-mini',
      'openai/gpt-4.1-mini',
      ' anthropic/claude-sonnet-4-5 ',
      '',
      ...Array.from({ length: 110 }, (_value, index) => `openrouter/model-${String(index)}`),
    ])

    const { getSettings } = await loadSettingsModule()
    const settings = getSettings()

    expect(settings.favoriteModels[0]).toBe('openai/gpt-4.1-mini')
    expect(settings.favoriteModels[1]).toBe('anthropic/claude-sonnet-4-5')
    expect(settings.favoriteModels).toHaveLength(100)
  })

  it('sanitizes skill toggles by project', async () => {
    await writeRawSetting('skillTogglesByProject', {
      ' /tmp/repo ': {
        ' code-review ': false,
        '': true,
      },
      '': {
        'frontend-design': true,
      },
    })

    const { getSettings } = await loadSettingsModule()
    const settings = getSettings()

    expect(settings.skillTogglesByProject).toEqual({
      '/tmp/repo': {
        'code-review': false,
      },
    })
  })

  it('roundtrips valid thinkingLevel through updateSettings', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({ thinkingLevel: 'max' })
    expect(getSettings().thinkingLevel).toBe('max')
  })

  it('roundtrips recentProjects through updateSettings', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({ recentProjects: ['/tmp/a', '/tmp/b'] })
    expect(getSettings().recentProjects).toEqual(['/tmp/a', '/tmp/b'])
  })

  it('orders durable browser profiles with pending ordinary settings writes', async () => {
    const {
      flushSettingsStoreForTests,
      getSettings,
      initializeSettingsStore,
      resetSettingsStoreForTests,
      updateSettings,
      updateSettingsDurably,
    } = await loadSettingsModule()
    updateSettings({ recentProjects: ['/tmp/before'] })
    const profileWrite = updateSettingsDurably({
      browserProfiles: [{ id: 'profile-imported', name: 'Imported', kind: 'persistent' }],
    })
    updateSettings({ thinkingLevel: 'high' })

    await profileWrite
    await flushSettingsStoreForTests()
    await resetSettingsStoreForTests()
    await initializeSettingsStore()

    expect(getSettings()).toMatchObject({
      browserProfiles: [{ id: 'profile-imported', name: 'Imported', kind: 'persistent' }],
      recentProjects: ['/tmp/before'],
      thinkingLevel: 'high',
    })
  })

  it('does not publish a durable profile when its SQLite transaction fails', async () => {
    const { getSettings, updateSettingsDurably } = await loadSettingsModule()
    const before = getSettings().browserProfiles
    await dropSettingsStoreForFailureTest()

    await expect(
      updateSettingsDurably({
        browserProfiles: [{ id: 'profile-orphan', name: 'Orphan', kind: 'persistent' }],
      }),
    ).rejects.toThrow()
    expect(getSettings().browserProfiles).toEqual(before)
  })

  it('roundtrips favoriteModels through updateSettings', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({
      favoriteModels: [
        SupportedModelId('openai/gpt-4.1-mini'),
        SupportedModelId('openai/gpt-4.1-mini'),
        SupportedModelId(' anthropic/claude-sonnet-4-5 '),
        SupportedModelId(''),
      ],
    })
    expect(getSettings().favoriteModels).toEqual([
      'openai/gpt-4.1-mini',
      'anthropic/claude-sonnet-4-5',
    ])
  })

  it('normalizes selectedModel through updateSettings', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({
      enabledModels: [SupportedModelId('openai-codex/gpt-5.4')],
      selectedModel: SupportedModelId('openai-codex/gpt-5.4'),
    })
    expect(getSettings().selectedModel).toBe('openai-codex/gpt-5.4')

    updateSettings({ selectedModel: SupportedModelId('gpt-5.4') })
    expect(getSettings().selectedModel).toBe('')
  })

  it('roundtrips skillTogglesByProject through updateSettings', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({
      skillTogglesByProject: {
        '/tmp/repo': { 'code-review': true, 'frontend-design': false },
      },
    })
    expect(getSettings().skillTogglesByProject).toEqual({
      '/tmp/repo': { 'code-review': true, 'frontend-design': false },
    })
  })
})
