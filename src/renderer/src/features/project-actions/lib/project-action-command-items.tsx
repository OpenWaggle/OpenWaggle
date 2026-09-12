import type { ProjectAction } from '@shared/types/project-actions'
import type { CommandPaletteItem } from '@/features/command-palette/model'
import { formatShortcutBinding } from '@/shared/lib/shortcut-display'
import { ProjectActionGlyph } from '../components/ProjectActionGlyph'
import {
  type BuiltInShortcutSource,
  projectActionHasShortcutConflicts,
  projectActionShortcutSummary,
} from './project-action-model'

export function createProjectActionCommandItems(
  actions: readonly ProjectAction[],
  builtInBindings: BuiltInShortcutSource,
  onRun: (action: ProjectAction) => void,
): CommandPaletteItem[] {
  return actions.map((action) => {
    const shortcut = projectActionShortcutSummary(action)
    const hasConflict = projectActionHasShortcutConflicts(action, actions, builtInBindings)
    return {
      id: `project-action:${action.id}`,
      label: action.name,
      description: action.runOnWorktreeCreate ? `${action.command} · setup` : action.command,
      icon: <ProjectActionGlyph icon={action.icon} />,
      section: 'Project actions',
      ...(shortcut.latest !== null
        ? {
            trailing: `${formatShortcutBinding(shortcut.latest.shortcut)}${
              shortcut.count > 1 ? ` +${String(shortcut.count - 1)}` : ''
            }${hasConflict ? ' · overlap' : ''}`,
          }
        : {}),
      action: () => onRun(action),
    }
  })
}
