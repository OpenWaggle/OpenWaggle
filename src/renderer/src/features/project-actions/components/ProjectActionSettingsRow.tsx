import type { ProjectAction } from '@shared/types/project-actions'
import { Settings } from 'lucide-react'
import { formatShortcutBinding } from '@/shared/lib/shortcut-display'
import { Button } from '@/shared/ui/Button'
import {
  type BuiltInShortcutSource,
  projectActionHasShortcutConflicts,
  projectActionShortcutSummary,
} from '../lib/project-action-model'
import { ProjectActionGlyph } from './ProjectActionGlyph'

interface ProjectActionSettingsRowProps {
  readonly action: ProjectAction
  readonly actions: readonly ProjectAction[]
  readonly builtInBindings: BuiltInShortcutSource
  readonly onEdit: (action: ProjectAction) => void
}

export function ProjectActionSettingsRow(props: ProjectActionSettingsRowProps) {
  const shortcut = projectActionShortcutSummary(props.action)
  const hasConflict = projectActionHasShortcutConflicts(
    props.action,
    props.actions,
    props.builtInBindings,
  )
  return (
    <div className="group flex min-h-16 items-center gap-3 border-t border-border px-4 py-2 first:border-t-0">
      <ProjectActionGlyph icon={props.action.icon} className="size-4 shrink-0 text-text-tertiary" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium text-text-primary">
            {props.action.name}
          </span>
          {props.action.runOnWorktreeCreate ? (
            <span className="rounded border border-border px-1.5 py-px text-xs text-text-tertiary">
              setup
            </span>
          ) : null}
          {props.action.previewUrl ? (
            <span className="rounded border border-border px-1.5 py-px text-xs text-text-tertiary">
              preview
            </span>
          ) : null}
        </div>
        <code className="mt-0.5 block truncate text-xs text-text-tertiary">
          {props.action.command}
        </code>
        {hasConflict ? (
          <span className="text-xs text-warning">One or more bindings overlap</span>
        ) : null}
      </div>
      {shortcut.latest !== null ? (
        <span
          className={
            hasConflict ? 'font-mono text-xs text-warning' : 'font-mono text-xs text-text-tertiary'
          }
        >
          {formatShortcutBinding(shortcut.latest.shortcut)}
          {shortcut.count > 1 ? ` +${String(shortcut.count - 1)}` : ''}
        </span>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Edit ${props.action.name}`}
        title={`Edit ${props.action.name}`}
        onClick={() => props.onEdit(props.action)}
        className="opacity-60 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <Settings className="size-3.5" />
      </Button>
    </div>
  )
}
