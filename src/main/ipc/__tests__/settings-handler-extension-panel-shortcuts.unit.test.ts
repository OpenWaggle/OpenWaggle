import { extensionRightPanelSurfaceId } from '@shared/types/right-panel-surface-id'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getSettingsMock,
  getTypedEffectInvokeHandler,
  loadSettingsHandlers,
  resetSettingsHandlerMocks,
  updateSettingsMock,
} from './settings-handler.test-harness'

const NOTES = extensionRightPanelSurfaceId({ extensionId: 'acme.notes', sidePanelId: 'notes' })
const BOARD = extensionRightPanelSurfaceId({ extensionId: 'acme.board', sidePanelId: 'board' })

async function update(patch: unknown, current: Settings = DEFAULT_SETTINGS) {
  getSettingsMock.mockReturnValue(current)
  const { registerSettingsHandlers } = await loadSettingsHandlers()
  registerSettingsHandlers()
  return getTypedEffectInvokeHandler('settings:update')?.({}, patch)
}

describe('extension panel shortcut updates', () => {
  beforeEach(() => {
    resetSettingsHandlerMocks()
  })

  it('accepts a unique binding keyed by a stable surface id', async () => {
    const extensionPanelShortcutBindings = { [NOTES]: { key: 'G', mod: true, shift: true } }

    await expect(update({ extensionPanelShortcutBindings })).resolves.toEqual({ ok: true })
    expect(updateSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ extensionPanelShortcutBindings }),
    )
  })

  it('rejects keys that are not extension surface ids', async () => {
    const result = await update({
      extensionPanelShortcutBindings: { '/packages/acme:hash:notes': { key: 'G', mod: true } },
    })

    expect(result).toEqual({ ok: false, error: expect.stringContaining('surface id') })
    expect(updateSettingsMock).not.toHaveBeenCalled()
  })

  it('rejects a binding a built-in command already uses', async () => {
    const result = await update({
      extensionPanelShortcutBindings: { [NOTES]: { key: 'D', mod: true } },
    })

    expect(result).toEqual({
      ok: false,
      error: 'Shortcut Mod+D is already assigned to Toggle diff.',
    })
    expect(updateSettingsMock).not.toHaveBeenCalled()
  })

  it('allows a combination owned only by a terminal-focused rule', async () => {
    // Mod+D also splits a focused terminal; extension panels never fire inside a terminal.
    const result = await update(
      { extensionPanelShortcutBindings: { [NOTES]: { key: 'D', mod: true } } },
      {
        ...DEFAULT_SETTINGS,
        shortcutRules: DEFAULT_SETTINGS.shortcutRules.filter(
          (rule) => rule.command !== 'diff.toggle',
        ),
      },
    )

    expect(result).toEqual({ ok: true })
  })

  it('rejects reserved combinations and duplicates between extension panels', async () => {
    await expect(
      update({ extensionPanelShortcutBindings: { [NOTES]: { key: 'F', mod: true } } }),
    ).resolves.toEqual({
      ok: false,
      error: 'Shortcut Mod+F is already assigned to Filter sessions.',
    })

    await expect(
      update({
        extensionPanelShortcutBindings: {
          [NOTES]: { key: 'G', mod: true, shift: true },
          [BOARD]: { key: 'G', mod: true, shift: true },
        },
      }),
    ).resolves.toEqual({
      ok: false,
      error: expect.stringContaining('Shortcut Mod+Shift+G is already assigned to extension panel'),
    })
    expect(updateSettingsMock).not.toHaveBeenCalled()
  })

  it('rejects a built-in rule that would take an extension panel binding', async () => {
    const current: Settings = {
      ...DEFAULT_SETTINGS,
      extensionPanelShortcutBindings: { [NOTES]: { key: 'G', mod: true, shift: true } },
    }
    const result = await update(
      {
        shortcutRules: [
          ...DEFAULT_SETTINGS.shortcutRules,
          { command: 'rightPanel.files', shortcut: { key: 'G', mod: true, shift: true } },
        ],
      },
      current,
    )

    expect(result).toEqual({
      ok: false,
      error:
        "Shortcut Mod+Shift+G is used by extension panel notes (acme.notes). Clear that panel's shortcut first.",
    })
    expect(updateSettingsMock).not.toHaveBeenCalled()
  })

  it('names the extension panel when resetting a built-in shortcut to a default it uses', async () => {
    // The user removed Toggle diff's Mod+D and gave it to an extension panel; resetting Toggle
    // diff restores Mod+D, which the panel now holds.
    const current: Settings = {
      ...DEFAULT_SETTINGS,
      shortcutRules: DEFAULT_SETTINGS.shortcutRules.filter(
        (rule) => rule.command !== 'diff.toggle',
      ),
      extensionPanelShortcutBindings: { [NOTES]: { key: 'D', mod: true } },
    }
    const result = await update({ shortcutRules: DEFAULT_SETTINGS.shortcutRules }, current)

    expect(result).toEqual({
      ok: false,
      error:
        "Shortcut Mod+D is used by extension panel notes (acme.notes). Clear that panel's shortcut first.",
    })
    expect(updateSettingsMock).not.toHaveBeenCalled()
  })

  it('names the extension panel that already holds a combination another panel takes', async () => {
    const current: Settings = {
      ...DEFAULT_SETTINGS,
      extensionPanelShortcutBindings: { [BOARD]: { key: 'G', mod: true, shift: true } },
    }
    const result = await update(
      {
        extensionPanelShortcutBindings: {
          [BOARD]: { key: 'G', mod: true, shift: true },
          [NOTES]: { key: 'G', mod: true, shift: true },
        },
      },
      current,
    )

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining('Shortcut Mod+Shift+G is'),
    })
    expect(result).toEqual({ ok: false, error: expect.stringContaining('board (acme.board)') })
  })

  it('does not block unrelated edits on a conflict that already existed', async () => {
    const current: Settings = {
      ...DEFAULT_SETTINGS,
      extensionPanelShortcutBindings: { [NOTES]: { key: 'D', mod: true } },
    }
    const result = await update(
      {
        extensionPanelShortcutBindings: {
          [NOTES]: { key: 'D', mod: true },
          [BOARD]: { key: 'H', mod: true, alt: true },
        },
      },
      current,
    )

    expect(result).toEqual({ ok: true })
  })
})
