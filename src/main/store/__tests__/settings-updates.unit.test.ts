import { SupportedModelId } from '@shared/types/brand'
import { extensionRightPanelSurfaceId } from '@shared/types/right-panel-surface-id'
import { describe, expect, it } from 'vitest'
import {
  dropSettingsStoreForFailureTest,
  installSettingsStoreTestLifecycle,
  loadSettingsModule,
  writeRawSetting,
} from './settings-test-harness'

const PANEL_ID = extensionRightPanelSurfaceId({ extensionId: 'acme.notes', sidePanelId: 'notes' })
const OTHER_PANEL_ID = extensionRightPanelSurfaceId({
  extensionId: 'acme.board',
  sidePanelId: 'board',
})

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

  it('persists Agent definition toggles independently and durably', async () => {
    const {
      flushSettingsStoreForTests,
      getSettings,
      initializeSettingsStore,
      resetSettingsStoreForTests,
      updateAgentDefinitionToggleDurably,
    } = await loadSettingsModule()
    await updateAgentDefinitionToggleDurably('/tmp/repo', 'reviewer', false)
    await updateAgentDefinitionToggleDurably('/tmp/repo', 'scout', true)
    await flushSettingsStoreForTests()
    await resetSettingsStoreForTests()
    await initializeSettingsStore()

    expect(getSettings().agentDefinitionTogglesByProject).toEqual({
      '/tmp/repo': { reviewer: false, scout: true },
    })
    expect(getSettings().skillTogglesByProject).toEqual({})
  })

  it('roundtrips valid thinkingLevel through updateSettings', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({ thinkingLevel: 'max' })
    expect(getSettings().thinkingLevel).toBe('max')
  })

  it('roundtrips the shared desktop and CLI update channel', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({ updateChannel: 'alpha' })
    expect(getSettings().updateChannel).toBe('alpha')
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

  it('persists extension panel shortcuts by stable surface id across a store reload', async () => {
    const {
      flushSettingsStoreForTests,
      getSettings,
      initializeSettingsStore,
      resetSettingsStoreForTests,
      updateSettings,
    } = await loadSettingsModule()
    updateSettings({
      extensionPanelShortcutBindings: {
        [PANEL_ID]: { key: 'G', mod: true, shift: true },
        [OTHER_PANEL_ID]: { key: 'H', mod: true, alt: true },
      },
    })
    await flushSettingsStoreForTests()
    await resetSettingsStoreForTests()
    await initializeSettingsStore()

    expect(getSettings().extensionPanelShortcutBindings).toEqual({
      [PANEL_ID]: { key: 'G', mod: true, shift: true },
      [OTHER_PANEL_ID]: { key: 'H', mod: true, alt: true },
    })
  })

  it('sanitizes extension panel shortcut updates: drops non-canonical ids and malformed bindings, trims keys', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({
      extensionPanelShortcutBindings: {
        [PANEL_ID]: { key: ' g ', mod: true, shift: false },
        '/packages/acme:hash:notes': { key: 'J', mod: true },
        'extension:["acme.notes"]': { key: 'K', mod: true },
        [OTHER_PANEL_ID]: { key: '' },
      },
    })

    expect(getSettings().extensionPanelShortcutBindings).toEqual({
      [PANEL_ID]: { key: 'g', mod: true },
    })
  })

  it('fails closed when saved extension panel shortcuts use an invalid surface id', async () => {
    await writeRawSetting('extensionPanelShortcutBindings', {
      'not-a-surface': { key: 'G', mod: true },
    })

    const { getSettings } = await loadSettingsModule()

    expect(() => getSettings()).toThrow(
      /Saved settings are invalid.*extensionPanelShortcutBindings/su,
    )
  })

  it('loads saved extension panel shortcuts for panels whose extension is no longer installed', async () => {
    await writeRawSetting('extensionPanelShortcutBindings', {
      [PANEL_ID]: { key: 'G', mod: true, shift: true },
    })

    const { getSettings } = await loadSettingsModule()

    expect(getSettings().extensionPanelShortcutBindings).toEqual({
      [PANEL_ID]: { key: 'G', mod: true, shift: true },
    })
  })
})
