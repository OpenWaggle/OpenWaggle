import { DEFAULT_SHORTCUT_RULES } from '@shared/types/shortcuts'
import { describe, expect, it } from 'vitest'
import { buildShortcutBrowserRows } from '../shortcut-browser-model'

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
})
