import { extensionRightPanelSurfaceId } from '@shared/types/right-panel-surface-id'
import { DEFAULT_SHORTCUT_RULES } from '@shared/types/shortcuts'
import { describe, expect, it } from 'vitest'
import { extensionPanelConflictSources } from '../panel-shortcut-model'
import { buildShortcutBrowserRows, shortcutBrowserConflictLabels } from '../shortcut-browser-model'

const ACTIONS = [
  {
    id: 'tests',
    name: 'Run tests',
    command: 'pnpm test',
    icon: 'test' as const,
    runOnWorktreeCreate: false,
    shortcutRules: [
      { shortcut: { key: 'D', mod: true }, when: '!terminalFocus', order: 4 },
      { shortcut: { key: 'R', mod: true }, when: 'terminalFocus', order: 7 },
    ],
  },
]

describe('shortcut browser model', () => {
  it('combines built-in and every project action rule with source and scope metadata', () => {
    const rows = buildShortcutBrowserRows(DEFAULT_SHORTCUT_RULES, ACTIONS)

    expect(rows.filter((row) => row.kind === 'project')).toHaveLength(2)
    expect(rows.find((row) => row.command === 'diff.toggle')).toMatchObject({
      source: 'Default',
      when: '!terminalFocus',
    })
    expect(rows.find((row) => row.id === 'project:tests:1')).toMatchObject({
      source: 'Project',
      when: 'terminalFocus',
      precedence: DEFAULT_SHORTCUT_RULES.length + 7,
    })
  })

  it('finds overlapping conditions across built-in and project rows', () => {
    const rows = buildShortcutBrowserRows(DEFAULT_SHORTCUT_RULES, ACTIONS)

    expect(rows.find((row) => row.id === 'project:tests:0')?.conflicts).toContain('Toggle diff')
    expect(rows.find((row) => row.command === 'diff.toggle')?.conflicts).toContain('Run tests')
    expect(rows.find((row) => row.id === 'project:tests:1')?.conflicts).not.toContain('Toggle diff')
  })

  it('searches labels, commands, keys, conditions, and sources', () => {
    expect(buildShortcutBrowserRows(DEFAULT_SHORTCUT_RULES, ACTIONS, 'pnpm test')).toHaveLength(2)
    expect(
      buildShortcutBrowserRows(DEFAULT_SHORTCUT_RULES, ACTIONS, 'projectAction.tests'),
    ).toHaveLength(2)
    expect(
      buildShortcutBrowserRows(DEFAULT_SHORTCUT_RULES, ACTIONS, 'terminalFocus').length,
    ).toBeGreaterThan(0)
    expect(buildShortcutBrowserRows(DEFAULT_SHORTCUT_RULES, ACTIONS, 'no such binding')).toEqual([])
  })

  it('labels reserved combinations whatever the key case', () => {
    expect(
      shortcutBrowserConflictLabels([], {
        rowId: 'new',
        binding: { key: 'f', mod: true },
        when: '',
      }),
    ).toEqual(['Filter sessions'])
  })

  it('labels a rule that collides with an extension panel shortcut', () => {
    const notes = extensionRightPanelSurfaceId({ extensionId: 'acme.notes', sidePanelId: 'notes' })
    const sources = [
      ...buildShortcutBrowserRows(DEFAULT_SHORTCUT_RULES, []),
      ...extensionPanelConflictSources([], { [notes]: { key: 'G', mod: true, shift: true } }),
    ]

    expect(
      shortcutBrowserConflictLabels(sources, {
        rowId: 'new',
        binding: { key: 'G', mod: true, shift: true },
        when: '',
      }),
    ).toEqual(['notes (acme.notes)'])
    expect(
      shortcutBrowserConflictLabels(sources, {
        rowId: 'new',
        binding: { key: 'G', mod: true, shift: true },
        when: 'terminalFocus',
      }),
    ).toEqual([])
  })
})
