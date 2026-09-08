import type { ProjectAction } from '@shared/types/project-actions'
import type { ShortcutRule } from '@shared/types/shortcuts'
import { describe, expect, it, vi } from 'vitest'
import { resolveUnifiedShortcut } from '../unified-shortcut-resolver'

const CONTEXT = {
  terminalFocus: false,
  terminalOpen: false,
  previewFocus: false,
  previewOpen: false,
  modelPickerOpen: false,
}
const EVENT = {
  key: 'r',
  code: 'KeyR',
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
}

describe('unified shortcut resolution', () => {
  it('uses the last active rule across built-in commands', () => {
    const rules: ShortcutRule[] = [
      { command: 'diff.toggle', shortcut: { key: 'R', mod: true } },
      { command: 'sidebar.toggle', shortcut: { key: 'R', mod: true }, when: 'previewOpen' },
    ]

    expect(resolveUnifiedShortcut(EVENT, rules, [], false, () => CONTEXT)).toMatchObject({
      kind: 'builtin',
      rule: { command: 'diff.toggle' },
    })
    expect(
      resolveUnifiedShortcut(EVENT, rules, [], false, () => ({ ...CONTEXT, previewOpen: true })),
    ).toMatchObject({ kind: 'builtin', rule: { command: 'sidebar.toggle' } })
  })

  it('places ordered Project Action rules after global built-in rules', () => {
    const action: ProjectAction = {
      id: 'tests',
      name: 'Run tests',
      command: 'pnpm test',
      icon: 'test',
      runOnWorktreeCreate: false,
      shortcutRules: [{ shortcut: { key: 'R', mod: true } }],
    }
    const getContext = vi.fn(() => CONTEXT)

    expect(
      resolveUnifiedShortcut(
        EVENT,
        [{ command: 'diff.toggle', shortcut: { key: 'R', mod: true } }],
        [action],
        false,
        getContext,
      ),
    ).toEqual({ kind: 'project', action })
    expect(getContext).toHaveBeenCalledOnce()
  })

  it('does not read DOM context when no chord matches', () => {
    const getContext = vi.fn(() => CONTEXT)
    expect(
      resolveUnifiedShortcut(
        { ...EVENT, key: 'x', code: 'KeyX' },
        [{ command: 'diff.toggle', shortcut: { key: 'R', mod: true } }],
        [],
        false,
        getContext,
      ),
    ).toBeNull()
    expect(getContext).not.toHaveBeenCalled()
  })
})
