import type { ProjectAction } from '@shared/types/project-actions'
import { extensionRightPanelSurfaceId } from '@shared/types/right-panel-surface-id'
import { DEFAULT_SHORTCUT_RULES, type ShortcutRule } from '@shared/types/shortcuts'
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

  it('resolves an extension panel binding only when no rule claims the key outside a terminal', () => {
    const surfaceId = extensionRightPanelSurfaceId({ extensionId: 'acme', sidePanelId: 'notes' })
    const panels = [{ surfaceId, shortcut: { key: 'R', mod: true } }]

    expect(resolveUnifiedShortcut(EVENT, [], [], false, () => CONTEXT, panels)).toEqual({
      kind: 'extension-panel',
      surfaceId,
    })
    expect(
      resolveUnifiedShortcut(
        EVENT,
        [{ command: 'diff.toggle', shortcut: { key: 'R', mod: true } }],
        [],
        false,
        () => CONTEXT,
        panels,
      ),
    ).toMatchObject({ kind: 'builtin' })
    expect(
      resolveUnifiedShortcut(
        EVENT,
        [],
        [],
        false,
        () => ({ ...CONTEXT, terminalFocus: true }),
        panels,
      ),
    ).toBeNull()
  })

  it('lets a panel the user bound keep its chord when a later default reuses it', () => {
    const surfaceId = extensionRightPanelSurfaceId({ extensionId: 'acme', sidePanelId: 'notes' })
    const panels = [{ surfaceId, shortcut: { key: 'L', mod: true, alt: true } }]
    const event = { ...EVENT, key: 'l', code: 'KeyL', altKey: true }

    expect(
      resolveUnifiedShortcut(event, DEFAULT_SHORTCUT_RULES, [], false, () => CONTEXT, panels),
    ).toEqual({ kind: 'extension-panel', surfaceId })
    // A rule the user saved still wins over the panel.
    expect(
      resolveUnifiedShortcut(
        event,
        [{ command: 'sidebar.toggle', shortcut: { key: 'L', mod: true, alt: true } }],
        [],
        false,
        () => CONTEXT,
        panels,
      ),
    ).toMatchObject({ kind: 'builtin' })
    expect(
      resolveUnifiedShortcut(event, DEFAULT_SHORTCUT_RULES, [], false, () => CONTEXT),
    ).toMatchObject({ kind: 'builtin', rule: { command: 'session.copyLink' } })
  })
})
