import { SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SHORTCUT_BINDINGS } from '@shared/types/shortcuts'
import { describe, expect, it } from 'vitest'
import {
  installSettingsTestHooks,
  loadSettingsModule,
  readRemovedPersistenceNames,
  readTableColumns,
  seedRemovedPersistenceForCleanup,
  writeRawSetting,
} from './settings-test-harness'

describe('settings store', () => {
  installSettingsTestHooks()

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

  it('falls back to medium thinking level when persisted value is invalid', async () => {
    await writeRawSetting('thinkingLevel', 'ultra')

    const { getSettings } = await loadSettingsModule()
    const settings = getSettings()

    expect(settings.thinkingLevel).toBe('medium')
  })

  it('resets corrupt duplicate shortcut bindings before global hotkeys are registered', async () => {
    await writeRawSetting('shortcutBindings', {
      ...DEFAULT_SHORTCUT_BINDINGS,
      'commandPalette.toggle': { key: 'P', mod: true },
      'filePicker.toggle': { key: 'P', mod: true },
    })

    const { getSettings } = await loadSettingsModule()

    expect(getSettings().shortcutBindings).toEqual(DEFAULT_SHORTCUT_BINDINGS)
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

  it('refreshes Session Host policy changed by another process', async () => {
    const { getSettings, refreshSettingsStore } = await loadSettingsModule()
    expect(getSettings().sessionHostRunCeiling).not.toBe(73)

    await writeRawSetting('sessionHostRunCeiling', 73)
    await writeRawSetting('multiAgentEnabled', false)
    await refreshSettingsStore()

    expect(getSettings()).toMatchObject({
      sessionHostRunCeiling: 73,
      multiAgentEnabled: false,
    })
  })

  it('hydrates an attached GUI cache from a normalized Host snapshot', async () => {
    const { getSettings, hydrateSettingsStoreFromHost } = await loadSettingsModule()

    hydrateSettingsStoreFromHost({
      ...getSettings(),
      sessionHostRunCeiling: 91,
      recentProjects: [' /tmp/host-project ', '/tmp/host-project'],
    })

    expect(getSettings()).toMatchObject({
      sessionHostRunCeiling: 91,
      recentProjects: ['/tmp/host-project'],
    })
  })

  it('roundtrips recentProjects through updateSettings', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({ recentProjects: ['/tmp/a', '/tmp/b'] })
    expect(getSettings().recentProjects).toEqual(['/tmp/a', '/tmp/b'])
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

  it('preserves concurrent skill toggles for the same project', async () => {
    const { getSettings, updateSkillToggleDurably } = await loadSettingsModule()

    await Promise.all([
      updateSkillToggleDurably('/tmp/concurrent', 'code-review', true),
      updateSkillToggleDurably('/tmp/concurrent', 'frontend-design', false),
    ])

    expect(getSettings().skillTogglesByProject['/tmp/concurrent']).toEqual({
      'code-review': true,
      'frontend-design': false,
    })
  })
})
