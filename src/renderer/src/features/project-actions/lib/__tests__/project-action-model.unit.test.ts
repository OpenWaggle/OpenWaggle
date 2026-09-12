import type { ProjectAction } from '@shared/types/project-actions'
import { DEFAULT_SHORTCUT_BINDINGS } from '@shared/types/shortcuts'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_PROJECT_ACTION_DRAFT,
  emptyProjectActionShortcutRuleDraft,
  primaryProjectAction,
  projectActionBindingFromEvent,
  projectActionShortcutConflictLabels,
  validateProjectActionDraft,
} from '../project-action-model'

function action(id: string, setup = false): ProjectAction {
  return {
    id,
    name: id,
    command: `pnpm ${id}`,
    icon: 'play',
    runOnWorktreeCreate: setup,
  }
}

describe('project action model', () => {
  it('prefers a surviving last invocation, then a non-setup action, then the first action', () => {
    const actions = [action('setup', true), action('test'), action('lint')]
    expect(primaryProjectAction(actions, 'lint')?.id).toBe('lint')
    expect(primaryProjectAction(actions, 'removed')?.id).toBe('test')
    expect(primaryProjectAction([action('setup', true)], null)?.id).toBe('setup')
    expect(primaryProjectAction([], null)).toBeNull()
  })

  it('records shift-only chords but leaves bare keys to hand-authored config', () => {
    expect(
      projectActionBindingFromEvent(
        { key: 'F6', altKey: false, ctrlKey: false, metaKey: false, shiftKey: true },
        false,
      ),
    ).toEqual({ key: 'F6', shift: true })
    expect(
      projectActionBindingFromEvent(
        { key: 'F6', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false },
        false,
      ),
    ).toBeNull()
  })

  it('normalizes scheme-less preview addresses through the browser preview policy', () => {
    const result = validateProjectActionDraft({
      ...EMPTY_PROJECT_ACTION_DRAFT,
      name: 'Dev',
      command: 'pnpm dev',
      previewUrl: 'localhost:5173/app',
      autoOpenPreview: true,
    })
    expect(result).toEqual({
      ok: true,
      input: {
        name: 'Dev',
        command: 'pnpm dev',
        icon: 'play',
        runOnWorktreeCreate: false,
        previewUrl: 'http://localhost:5173/app',
        autoOpenPreview: true,
        shortcutRules: [],
      },
    })
  })

  it('rejects credential-bearing preview addresses', () => {
    const result = validateProjectActionDraft({
      ...EMPTY_PROJECT_ACTION_DRAFT,
      name: 'Dev',
      command: 'pnpm dev',
      previewUrl: 'https://user:secret@example.com',
    })
    expect(result).toEqual({
      ok: false,
      error: 'Preview URL must be a valid http or https address.',
    })
  })

  it('detects built-in and project-action shortcut conflicts', () => {
    const actions: ProjectAction[] = [
      { ...action('test'), shortcutRules: [{ shortcut: { key: 'R', ctrl: true } }] },
      { ...action('lint'), shortcutRules: [{ shortcut: { key: 'L', ctrl: true } }] },
    ]
    expect(
      projectActionShortcutConflictLabels(
        'test',
        0,
        { shortcut: DEFAULT_SHORTCUT_BINDINGS['terminal.toggle'] },
        actions,
        DEFAULT_SHORTCUT_BINDINGS,
      ),
    ).toEqual(['Toggle terminal'])
    expect(
      projectActionShortcutConflictLabels(
        'test',
        0,
        { shortcut: { key: 'L', ctrl: true } },
        actions,
        DEFAULT_SHORTCUT_BINDINGS,
      ),
    ).toEqual(['lint'])
  })

  it('persists multiple valid conditions and rejects malformed expressions', () => {
    const valid = validateProjectActionDraft({
      ...EMPTY_PROJECT_ACTION_DRAFT,
      name: 'Dev',
      command: 'pnpm dev',
      shortcutRules: [
        {
          ...emptyProjectActionShortcutRuleDraft(),
          shortcut: { key: 'D', mod: true },
          when: 'terminalOpen && !terminalFocus',
          order: 3,
        },
        {
          ...emptyProjectActionShortcutRuleDraft(),
          shortcut: { key: 'D', mod: true, shift: true },
          when: 'previewOpen',
        },
      ],
    })
    expect(valid).toEqual({
      ok: true,
      input: {
        name: 'Dev',
        command: 'pnpm dev',
        icon: 'play',
        runOnWorktreeCreate: false,
        previewUrl: null,
        autoOpenPreview: false,
        shortcutRules: [
          {
            shortcut: { key: 'D', mod: true },
            when: 'terminalOpen && !terminalFocus',
            order: 3,
          },
          { shortcut: { key: 'D', mod: true, shift: true }, when: 'previewOpen' },
        ],
      },
    })

    expect(
      validateProjectActionDraft({
        ...EMPTY_PROJECT_ACTION_DRAFT,
        name: 'Dev',
        command: 'pnpm dev',
        shortcutRules: [
          {
            ...emptyProjectActionShortcutRuleDraft(),
            shortcut: { key: 'D', mod: true },
            when: 'terminalFocus &&',
          },
        ],
      }),
    ).toEqual({
      ok: false,
      error: 'Binding 1 condition must use variables with !, &&, ||, and parentheses.',
    })
  })
})
