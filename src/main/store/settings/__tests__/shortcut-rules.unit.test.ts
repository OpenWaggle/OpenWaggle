import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { DEFAULT_SHORTCUT_BINDINGS, DEFAULT_SHORTCUT_RULES } from '@shared/types/shortcuts'
import { describe, expect, it } from 'vitest'
import { buildNextSettingsSnapshot, buildSettingsSnapshot } from '../snapshot'

describe('settings shortcut rules', () => {
  it('loads the complete ordered default array for a fresh profile', () => {
    const { settings } = buildSettingsSnapshot({})

    expect(settings.shortcutRules).toEqual(DEFAULT_SHORTCUT_RULES)
    expect(settings.shortcutRules.filter((rule) => rule.command === 'preview.zoomIn')).toHaveLength(
      2,
    )
  })

  it('migrates legacy bindings with fixed contexts and derives their compatibility view', () => {
    const legacy = {
      ...DEFAULT_SHORTCUT_BINDINGS,
      'diff.toggle': { key: 'G', mod: true },
    }

    const { settings } = buildSettingsSnapshot({ shortcutBindings: legacy })

    expect(settings.shortcutRules).toContainEqual({
      command: 'diff.toggle',
      shortcut: { key: 'G', mod: true },
      when: '!terminalFocus',
    })
    expect(settings.shortcutRules).toContainEqual({
      command: 'preview.zoomIn',
      shortcut: { key: '+', mod: true },
      when: 'previewFocus',
    })
    expect(settings.shortcutBindings['diff.toggle']).toEqual({ key: 'G', mod: true })
  })

  it('merges defaults ahead of a minimal custom array and keeps the custom rule newest', () => {
    const customRule = {
      command: 'diff.toggle',
      shortcut: { key: 'G', mod: true },
      when: 'previewOpen',
    } as const

    const { settings } = buildSettingsSnapshot({ shortcutRules: [customRule] })

    expect(settings.shortcutRules.filter((rule) => rule.command === 'diff.toggle')).toEqual([
      customRule,
    ])
    expect(settings.shortcutRules.at(-1)).toEqual(customRule)
    expect(settings.shortcutRules.some((rule) => rule.command === 'terminal.toggle')).toBe(true)
  })

  it('updates canonical rules and the legacy compatibility view together', () => {
    const customRule = {
      command: 'sidebar.toggle',
      shortcut: { key: 'S', ctrl: true, alt: true },
      when: 'previewOpen',
    } as const

    const next = buildNextSettingsSnapshot(DEFAULT_SETTINGS, { shortcutRules: [customRule] })

    expect(next.shortcutRules.at(-1)).toEqual(customRule)
    expect(next.shortcutBindings['sidebar.toggle']).toEqual(customRule.shortcut)
  })
})
