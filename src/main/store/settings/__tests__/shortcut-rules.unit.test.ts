import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { DEFAULT_SHORTCUT_BINDINGS, DEFAULT_SHORTCUT_RULES } from '@shared/types/shortcuts'
import { describe, expect, it } from 'vitest'
import { validatePersistedSettings } from '../persisted-validation'
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

  it('keeps legacy bindings when a newly added default uses one of their chords', () => {
    // A record saved before `session.copyLink` existed, with its default chord on another command.
    const { 'session.copyLink': _added, ...saved } = DEFAULT_SHORTCUT_BINDINGS
    const legacy = { ...saved, 'sidebar.toggle': { key: 'L', mod: true, alt: true } }

    const { settings } = buildSettingsSnapshot({ shortcutBindings: legacy })

    expect(settings.shortcutBindings['sidebar.toggle']).toEqual({ key: 'L', mod: true, alt: true })
    expect(settings.shortcutBindings['diff.toggle']).toEqual(
      DEFAULT_SHORTCUT_BINDINGS['diff.toggle'],
    )
    // The user's own binding is the newest rule for the chord, so it wins over the new default.
    const sameChord = settings.shortcutRules.filter(
      (rule) =>
        rule.shortcut.key === 'L' && rule.shortcut.mod === true && rule.shortcut.alt === true,
    )
    expect(sameChord.map((rule) => rule.command)).toEqual(['sidebar.toggle'])
    // The new command starts unassigned rather than showing a chord that runs another command.
    expect(settings.shortcutBindings['session.copyLink']).toBeNull()
  })

  it('still reads saved settings whose bindings already use a newly added default chord', () => {
    const { 'session.copyLink': _added, ...saved } = DEFAULT_SHORTCUT_BINDINGS
    const shortcutBindings = { ...saved, 'sidebar.toggle': { key: 'L', mod: true, alt: true } }

    expect(() => validatePersistedSettings({ shortcutBindings })).not.toThrow()
    // A record that conflicts with itself is still corrupt.
    expect(() =>
      validatePersistedSettings({
        shortcutBindings: {
          ...DEFAULT_SHORTCUT_BINDINGS,
          'sidebar.toggle': { key: 'J', mod: true },
        },
      }),
    ).toThrow('Shortcut')
  })

  it('leaves a new default out of saved rules that already use its chord', () => {
    const customRule = {
      command: 'sidebar.toggle',
      shortcut: { key: 'L', mod: true, alt: true },
    } as const
    const { settings } = buildSettingsSnapshot({ shortcutRules: [customRule] })

    expect(settings.shortcutRules.some((rule) => rule.command === 'session.copyLink')).toBe(false)
    expect(settings.shortcutBindings['session.copyLink']).toBeNull()
    expect(settings.shortcutRules.at(-1)).toEqual(customRule)
  })

  it('keeps a default whose chord a saved rule only holds in another context', () => {
    const terminalRule = {
      command: 'terminal.new',
      shortcut: { key: 'L', mod: true, alt: true },
      when: 'terminalFocus',
    } as const
    const { settings } = buildSettingsSnapshot({ shortcutRules: [terminalRule] })

    expect(settings.shortcutRules).toContainEqual(
      DEFAULT_SHORTCUT_RULES.find((rule) => rule.command === 'session.copyLink'),
    )
  })

  it('reads the bindings view of saved rules that share a chord, as rules may', () => {
    const shortcutRules = [
      ...DEFAULT_SHORTCUT_RULES,
      { command: 'sidebar.toggle', shortcut: { key: 'L', mod: true, alt: true } },
    ]
    const shortcutBindings = {
      ...DEFAULT_SHORTCUT_BINDINGS,
      'sidebar.toggle': { key: 'L', mod: true, alt: true },
    }

    expect(() => validatePersistedSettings({ shortcutRules, shortcutBindings })).not.toThrow()
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
