import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { DEFAULT_SHORTCUT_BINDINGS } from '@shared/types/shortcuts'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getBranchSummarySkipPromptMock,
  getSettingsMock,
  getTreeFilterModeMock,
  getTypedEffectInvokeHandler,
  loadSettingsHandlers,
  resetSettingsHandlerMocks,
  setTreeFilterModeMock,
  updateSettingsMock,
} from './settings-handler.test-harness'

describe('settings appearance, shortcuts, and Pi preferences', () => {
  let registerSettingsHandlers: Awaited<
    ReturnType<typeof loadSettingsHandlers>
  >['registerSettingsHandlers']

  beforeEach(async () => {
    resetSettingsHandlerMocks()
    ;({ registerSettingsHandlers } = await loadSettingsHandlers())
  })

  it('validates and applies appearance and session-default settings', async () => {
    registerSettingsHandlers()

    const handler = getTypedEffectInvokeHandler('settings:update')
    expect(handler).toBeDefined()

    const update = {
      defaultSessionEnvironmentMode: 'worktree',
      diffSyntaxTheme: 'pierre-dark-vibrant',
      syntaxThemeSelections: {
        light: 'bundled:github-light',
        dark: 'bundled:github-dark',
        'high-contrast-light': 'bundled:github-light-high-contrast',
        'high-contrast-dark': 'bundled:github-dark-high-contrast',
      },
      diffView: 'split',
      diffWrapLines: true,
      appearancePreferences: {
        typography: {
          ...DEFAULT_SETTINGS.appearancePreferences.typography,
          interfaceFontFamily: 'Inter, system-ui, sans-serif',
          codeFontSize: 14,
        },
        terminalPalette: {
          ...DEFAULT_SETTINGS.appearancePreferences.terminalPalette,
          cursor: '#ffcc00',
          selection: '#33669988',
        },
        motion: 'reduced',
      },
    } as const

    const result = await handler?.({}, update)

    expect(result).toEqual({ ok: true })
    expect(updateSettingsMock).toHaveBeenCalledWith(expect.objectContaining(update))
  })

  it('rejects invalid terminal palette colors without calling the settings service', async () => {
    registerSettingsHandlers()

    const handler = getTypedEffectInvokeHandler('settings:update')
    const result = await handler?.(
      {},
      {
        appearancePreferences: {
          ...DEFAULT_SETTINGS.appearancePreferences,
          terminalPalette: {
            ...DEFAULT_SETTINGS.appearancePreferences.terminalPalette,
            background: 'url(javascript:alert(1))',
          },
        },
      },
    )

    expect(result).toEqual({ ok: false, error: expect.stringContaining('hex colour') })
    expect(updateSettingsMock).not.toHaveBeenCalled()
  })

  it('rejects incomplete syntax theme selections', async () => {
    registerSettingsHandlers()

    const handler = getTypedEffectInvokeHandler('settings:update')
    const result = await handler?.(
      {},
      {
        syntaxThemeSelections: {
          light: 'bundled:github-light',
          dark: 'bundled:github-dark',
        },
      },
    )

    expect(result).toEqual({ ok: false, error: expect.any(String) })
    expect(updateSettingsMock).not.toHaveBeenCalled()
  })

  it('rejects duplicate shortcut bindings without replacing existing customizations', async () => {
    const currentSettings = {
      ...DEFAULT_SETTINGS,
      shortcutBindings: {
        ...DEFAULT_SHORTCUT_BINDINGS,
        'diff.toggle': null,
        'sidebar.toggle': { key: 'D', mod: true },
        'terminal.toggle': { key: 'T', mod: true, shift: true },
      },
    }
    getSettingsMock.mockReturnValue(currentSettings)
    registerSettingsHandlers()

    const handler = getTypedEffectInvokeHandler('settings:update')
    const result = await handler?.(
      {},
      {
        shortcutBindings: {
          ...currentSettings.shortcutBindings,
          'diff.toggle': DEFAULT_SHORTCUT_BINDINGS['diff.toggle'],
        },
      },
    )

    expect(result).toEqual({ ok: false, error: expect.stringContaining('already assigned') })
    expect(updateSettingsMock).not.toHaveBeenCalled()
    expect(currentSettings.shortcutBindings['terminal.toggle']).toEqual({
      key: 'T',
      mod: true,
      shift: true,
    })
  })

  it('accepts ordered conditional shortcut rules with intentional overlaps', async () => {
    registerSettingsHandlers()
    const shortcutRules = [
      { command: 'terminal.close', shortcut: { key: 'W', mod: true }, when: 'terminalFocus' },
      { command: 'rightPanel.close', shortcut: { key: 'W', mod: true }, when: '!terminalFocus' },
      { command: 'diff.toggle', shortcut: { key: 'W', mod: true }, when: 'previewOpen' },
    ] as const

    const handler = getTypedEffectInvokeHandler('settings:update')
    const result = await handler?.({}, { shortcutRules })

    expect(result).toEqual({ ok: true })
    expect(updateSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ shortcutRules }))
  })

  it('rejects malformed shortcut rule conditions before persistence', async () => {
    registerSettingsHandlers()

    const handler = getTypedEffectInvokeHandler('settings:update')
    const result = await handler?.(
      {},
      {
        shortcutRules: [
          {
            command: 'diff.toggle',
            shortcut: { key: 'D', mod: true },
            when: 'terminalFocus &&',
          },
        ],
      },
    )

    expect(result).toEqual({ ok: false, error: expect.any(String) })
    expect(updateSettingsMock).not.toHaveBeenCalled()
  })

  it('returns the persisted Pi tree filter mode', async () => {
    getTreeFilterModeMock.mockReturnValue('no-tools')
    registerSettingsHandlers()

    const handler = getTypedEffectInvokeHandler('pi-settings:get-tree-filter-mode')
    expect(handler).toBeDefined()

    const result = await handler?.({}, null)
    expect(result).toBe('no-tools')
    expect(getTreeFilterModeMock).toHaveBeenCalledWith(undefined)
  })

  it('validates and persists a Pi tree filter mode', async () => {
    registerSettingsHandlers()

    const handler = getTypedEffectInvokeHandler('pi-settings:set-tree-filter-mode')
    expect(handler).toBeDefined()

    const result = await handler?.({}, 'labeled-only', null)
    expect(result).toBeUndefined()
    expect(setTreeFilterModeMock).toHaveBeenCalledWith('labeled-only', undefined)
  })

  it('rejects invalid Pi tree filter modes', async () => {
    registerSettingsHandlers()

    const handler = getTypedEffectInvokeHandler('pi-settings:set-tree-filter-mode')
    expect(handler).toBeDefined()

    await expect(handler?.({}, 'bad-mode', null)).rejects.toThrow('Invalid tree filter mode')
    expect(setTreeFilterModeMock).not.toHaveBeenCalled()
  })

  it('returns the Pi branch-summary skip-prompt preference', async () => {
    getBranchSummarySkipPromptMock.mockReturnValue(true)
    registerSettingsHandlers()

    const handler = getTypedEffectInvokeHandler('pi-settings:get-branch-summary-skip-prompt')
    expect(handler).toBeDefined()

    const result = await handler?.({}, null)
    expect(result).toBe(true)
    expect(getBranchSummarySkipPromptMock).toHaveBeenCalledWith(undefined)
  })
})
