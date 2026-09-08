import type { ProjectAction } from '@shared/types/project-actions'
import {
  evaluateProjectActionWhen,
  formatProjectActionWhenExpression,
  orderedProjectActionShortcuts,
  parseProjectActionWhenExpression,
  projectActionShortcutMatches,
  projectActionShortcutRules,
  projectActionWhenIdentifiers,
  projectActionWhenMatches,
} from '@shared/utils/project-action-shortcuts'
import { describe, expect, it } from 'vitest'

const EMPTY_CONTEXT = {
  terminalFocus: false,
  terminalOpen: false,
  previewFocus: false,
  previewOpen: false,
  modelPickerOpen: false,
}

function action(id: string): ProjectAction {
  return {
    id,
    name: id,
    command: `pnpm ${id}`,
    icon: 'play',
    runOnWorktreeCreate: false,
  }
}

describe('project action shortcut conditions', () => {
  it('parses T3 identifiers and gives && precedence over ||', () => {
    const expression = parseProjectActionWhenExpression(
      'terminalFocus || previewOpen && !modelPickerOpen',
    )

    expect(expression).not.toBeNull()
    if (expression === null) return
    expect(
      evaluateProjectActionWhen(expression, {
        ...EMPTY_CONTEXT,
        previewOpen: true,
      }),
    ).toBe(true)
    expect(
      evaluateProjectActionWhen(expression, {
        ...EMPTY_CONTEXT,
        previewOpen: true,
        modelPickerOpen: true,
      }),
    ).toBe(false)
  })

  it.each(['', 'terminalFocus &&', 'terminalFocus & previewOpen', '(terminalFocus'])(
    'rejects malformed expression %j',
    (expression) => {
      expect(parseProjectActionWhenExpression(expression)).toBeNull()
    },
  )

  it('supports true, false, unknown variables, negation, and parentheses', () => {
    expect(projectActionWhenMatches('true && !false', EMPTY_CONTEXT)).toBe(true)
    expect(projectActionWhenMatches('unknownContext', EMPTY_CONTEXT)).toBe(false)
    expect(projectActionWhenMatches('!(terminalFocus || previewFocus)', EMPTY_CONTEXT)).toBe(true)
  })

  it('collects distinct condition identifiers for editor diagnostics', () => {
    expect(
      projectActionWhenIdentifiers('terminalFocus && (!custom.mode || terminalFocus)'),
    ).toEqual(['terminalFocus', 'custom.mode'])
  })

  it('formats nested expressions without changing precedence', () => {
    const parsed = parseProjectActionWhenExpression(
      '!(terminalFocus || previewOpen) && modelPickerOpen',
    )

    expect(parsed).not.toBeNull()
    if (parsed === null) return
    const formatted = formatProjectActionWhenExpression(parsed)
    expect(formatted).toBe('!(terminalFocus || previewOpen) && modelPickerOpen')
    expect(parseProjectActionWhenExpression(formatted)).toEqual(parsed)
  })
})

describe('project action shortcut ordering', () => {
  it('reads legacy one-shortcut actions without mutating them', () => {
    const legacy = { ...action('legacy'), shortcut: { key: 'R', mod: true } }

    expect(projectActionShortcutRules(legacy)).toEqual([{ shortcut: { key: 'R', mod: true } }])
    expect(legacy).not.toHaveProperty('shortcutRules')
  })

  it('sorts by explicit global order with stable file-order fallback', () => {
    const actions: ProjectAction[] = [
      {
        ...action('first'),
        shortcutRules: [
          { shortcut: { key: 'A', mod: true }, order: 4 },
          { shortcut: { key: 'B', mod: true } },
        ],
      },
      {
        ...action('second'),
        shortcutRules: [{ shortcut: { key: 'C', mod: true }, order: 1 }],
      },
    ]

    expect(orderedProjectActionShortcuts(actions).map((entry) => entry.rule.shortcut.key)).toEqual([
      'B',
      'C',
      'A',
    ])
  })
})

describe('project action shortcut matching', () => {
  const event = {
    key: 'r',
    code: 'KeyR',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  }

  it('resolves Mod exactly for the current platform', () => {
    expect(projectActionShortcutMatches(event, { key: 'R', mod: true }, false)).toBe(true)
    expect(projectActionShortcutMatches(event, { key: 'R', mod: true }, true)).toBe(false)
  })

  it('uses physical letters only as a fallback for non-Latin layouts', () => {
    expect(
      projectActionShortcutMatches(
        { ...event, key: 'q', code: 'KeyR' },
        { key: 'R', mod: true },
        false,
      ),
    ).toBe(false)
    expect(
      projectActionShortcutMatches(
        { ...event, key: 'к', code: 'KeyR' },
        { key: 'R', mod: true },
        false,
      ),
    ).toBe(true)
  })
})
