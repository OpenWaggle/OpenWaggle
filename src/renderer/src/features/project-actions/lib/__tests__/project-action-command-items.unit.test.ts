import type { ProjectAction } from '@shared/types/project-actions'
import { DEFAULT_SHORTCUT_BINDINGS } from '@shared/types/shortcuts'
import { describe, expect, it, vi } from 'vitest'
import { createProjectActionCommandItems } from '../project-action-command-items'

const ACTIONS: readonly ProjectAction[] = [
  {
    id: 'test',
    name: 'Test',
    command: 'pnpm test',
    icon: 'test',
    runOnWorktreeCreate: false,
    shortcutRules: [{ shortcut: { key: 'R', ctrl: true } }],
  },
  {
    id: 'setup',
    name: 'Setup',
    command: 'pnpm install',
    icon: 'configure',
    runOnWorktreeCreate: true,
  },
]

describe('project action command items', () => {
  it('registers every saved action with shortcut and setup context', () => {
    const onRun = vi.fn()
    const items = createProjectActionCommandItems(ACTIONS, DEFAULT_SHORTCUT_BINDINGS, onRun)

    expect(
      items.map(({ id, label, description, section, trailing }) => ({
        id,
        label,
        description,
        section,
        trailing,
      })),
    ).toEqual([
      {
        id: 'project-action:test',
        label: 'Test',
        description: 'pnpm test',
        section: 'Project actions',
        trailing: 'Ctrl + R',
      },
      {
        id: 'project-action:setup',
        label: 'Setup',
        description: 'pnpm install · setup',
        section: 'Project actions',
        trailing: undefined,
      },
    ])
    items[0]?.action()
    expect(onRun).toHaveBeenCalledExactlyOnceWith(ACTIONS[0])
  })
})
