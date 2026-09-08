import {
  DEFAULT_SHORTCUT_BINDINGS,
  DEFAULT_SHORTCUT_RULES,
  type ShortcutRule,
  shortcutRuleIdentity,
  shortcutRulesFromBindings,
  shortcutRulesWithDefaults,
} from '@shared/types/shortcuts'
import {
  activeShortcutRuleForCommand,
  removeShortcutRule,
  resolveMatchingShortcutRule,
  upsertShortcutRule,
} from '@shared/utils/shortcut-rules'
import { describe, expect, it } from 'vitest'

const CONTEXT = {
  terminalFocus: false,
  terminalOpen: false,
  previewFocus: false,
  previewOpen: false,
  modelPickerOpen: false,
}

describe('ordered shortcut rules', () => {
  it('keeps the audited T3 defaults, contexts, and duplicate zoom-in chords in order', () => {
    expect(DEFAULT_SHORTCUT_RULES.slice(0, 20)).toEqual([
      { command: 'sidebar.toggle', shortcut: { key: 'B', mod: true } },
      { command: 'terminal.toggle', shortcut: { key: 'J', mod: true } },
      { command: 'rightPanel.toggle', shortcut: { key: 'B', mod: true, alt: true } },
      { command: 'terminal.split', shortcut: { key: 'D', mod: true }, when: 'terminalFocus' },
      {
        command: 'terminal.splitVertical',
        shortcut: { key: 'D', mod: true, shift: true },
        when: 'terminalFocus',
      },
      { command: 'terminal.new', shortcut: { key: 'N', mod: true }, when: 'terminalFocus' },
      { command: 'terminal.close', shortcut: { key: 'W', mod: true }, when: 'terminalFocus' },
      { command: 'rightPanel.close', shortcut: { key: 'W', mod: true }, when: '!terminalFocus' },
      { command: 'diff.toggle', shortcut: { key: 'D', mod: true }, when: '!terminalFocus' },
      { command: 'preview.toggle', shortcut: { key: 'J', mod: true, shift: true } },
      { command: 'preview.refresh', shortcut: { key: 'R', mod: true }, when: 'previewFocus' },
      { command: 'preview.focusUrl', shortcut: { key: 'L', mod: true }, when: 'previewFocus' },
      { command: 'preview.zoomIn', shortcut: { key: '=', mod: true }, when: 'previewFocus' },
      { command: 'preview.zoomIn', shortcut: { key: '+', mod: true }, when: 'previewFocus' },
      { command: 'preview.zoomOut', shortcut: { key: '-', mod: true }, when: 'previewFocus' },
      { command: 'preview.resetZoom', shortcut: { key: '0', mod: true }, when: 'previewFocus' },
      {
        command: 'commandPalette.toggle',
        shortcut: { key: 'K', mod: true },
        when: '!terminalFocus',
      },
      { command: 'filePicker.toggle', shortcut: { key: 'P', mod: true }, when: '!terminalFocus' },
      { command: 'chat.new', shortcut: { key: 'N', mod: true }, when: '!terminalFocus' },
      {
        command: 'chat.new',
        shortcut: { key: 'O', mod: true, shift: true },
        when: '!terminalFocus',
      },
    ])
  })

  it('walks globally from newest to oldest and skips inactive conditions', () => {
    const rules: ShortcutRule[] = [
      { command: 'diff.toggle', shortcut: { key: 'D', mod: true }, when: '!terminalFocus' },
      { command: 'terminal.split', shortcut: { key: 'D', mod: true }, when: 'terminalFocus' },
      { command: 'sidebar.toggle', shortcut: { key: 'D', mod: true }, when: 'previewOpen' },
    ]
    const event = {
      key: 'd',
      code: 'KeyD',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    }

    expect(resolveMatchingShortcutRule(event, rules, CONTEXT, false)?.rule.command).toBe(
      'diff.toggle',
    )
    expect(
      resolveMatchingShortcutRule(event, rules, { ...CONTEXT, previewOpen: true }, false)?.rule
        .command,
    ).toBe('sidebar.toggle')
  })

  it('selects the newest active rule for command labels', () => {
    const rules: ShortcutRule[] = [
      { command: 'terminal.toggle', shortcut: { key: 'J', mod: true } },
      { command: 'terminal.toggle', shortcut: { key: 'T', mod: true }, when: 'terminalOpen' },
    ]
    expect(activeShortcutRuleForCommand(rules, 'terminal.toggle', CONTEXT)?.shortcut.key).toBe('J')
    expect(
      activeShortcutRuleForCommand(rules, 'terminal.toggle', {
        ...CONTEXT,
        terminalOpen: true,
      })?.shortcut.key,
    ).toBe('T')
  })

  it('hides a command label when a newer active command claims the same platform chord', () => {
    const rules: ShortcutRule[] = [
      { command: 'diff.toggle', shortcut: { key: 'D', mod: true } },
      { command: 'sidebar.toggle', shortcut: { key: 'D', ctrl: true } },
    ]

    expect(activeShortcutRuleForCommand(rules, 'diff.toggle', CONTEXT, false)).toBeNull()
    expect(activeShortcutRuleForCommand(rules, 'diff.toggle', CONTEXT, true)?.shortcut).toEqual({
      key: 'D',
      mod: true,
    })
  })

  it('upserts by exact identity at the end and removes exact duplicates', () => {
    const original = DEFAULT_SHORTCUT_RULES[0]
    if (original === undefined) throw new Error('Expected a default shortcut rule')
    const replacement = { ...original, shortcut: { key: 'L', mod: true } }
    const upserted = upsertShortcutRule(
      [...DEFAULT_SHORTCUT_RULES, replacement],
      replacement,
      original,
    )

    expect(upserted.at(-1)).toEqual(replacement)
    expect(
      upserted.filter((rule) => shortcutRuleIdentity(rule) === shortcutRuleIdentity(replacement)),
    ).toHaveLength(1)
    expect(removeShortcutRule(upserted, replacement)).not.toContainEqual(replacement)
  })

  it('migrates the legacy record and supplies defaults only for commands without custom rules', () => {
    const migrated = shortcutRulesFromBindings(DEFAULT_SHORTCUT_BINDINGS)
    expect(migrated).toEqual(DEFAULT_SHORTCUT_RULES)
    expect(
      migrated.filter((rule) => rule.command === 'preview.zoomIn').map((rule) => rule.shortcut.key),
    ).toEqual(['=', '+'])

    const custom: ShortcutRule[] = [
      { command: 'diff.toggle', shortcut: { key: 'G', mod: true }, when: 'previewOpen' },
    ]
    const resolved = shortcutRulesWithDefaults(custom)
    expect(resolved.filter((rule) => rule.command === 'diff.toggle')).toEqual(custom)
    expect(resolved.at(-1)).toEqual(custom[0])
    expect(resolved.some((rule) => rule.command === 'terminal.toggle')).toBe(true)
  })
})
