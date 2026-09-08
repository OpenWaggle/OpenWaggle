import type {
  ProjectAction,
  T3ProjectActionScript,
  T3ProjectActionsDiscovery,
} from '@shared/types/project-actions'
import { Download, Plus, Settings } from 'lucide-react'
import { formatShortcutBinding } from '@/shared/lib/shortcut-display'
import { Button } from '@/shared/ui/Button'
import {
  type BuiltInShortcutSource,
  projectActionHasShortcutConflicts,
  projectActionShortcutSummary,
} from '../lib/project-action-model'
import { ProjectActionGlyph } from './ProjectActionGlyph'

interface ProjectActionsMenuProps {
  readonly model: {
    readonly actions: readonly ProjectAction[]
    readonly candidates: readonly T3ProjectActionScript[]
    readonly discovery: T3ProjectActionsDiscovery | undefined
    readonly builtInBindings: BuiltInShortcutSource
    readonly saving: boolean
  }
  readonly handlers: {
    readonly run: (action: ProjectAction) => void
    readonly edit: (action: ProjectAction) => void
    readonly importT3: (sourceIndex: number) => void
    readonly add: () => void
  }
}

function SavedActionMenuRow(props: {
  readonly action: ProjectAction
  readonly actions: readonly ProjectAction[]
  readonly builtInBindings: BuiltInShortcutSource
  readonly onRun: () => void
  readonly onEdit: () => void
}) {
  const shortcut = projectActionShortcutSummary(props.action)
  const hasConflict = projectActionHasShortcutConflicts(
    props.action,
    props.actions,
    props.builtInBindings,
  )
  return (
    <div className="group flex items-center rounded-md hover:bg-bg-hover focus-within:bg-bg-hover">
      <Button
        role="menuitem"
        variant="unstyled"
        onClick={props.onRun}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs text-text-secondary"
      >
        <ProjectActionGlyph icon={props.action.icon} className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {props.action.name}
          {props.action.runOnWorktreeCreate ? ' (setup)' : ''}
        </span>
        {shortcut.latest !== null ? (
          <span className={hasConflict ? 'text-warning' : 'text-text-muted'}>
            {formatShortcutBinding(shortcut.latest.shortcut)}
            {shortcut.count > 1 ? ` +${String(shortcut.count - 1)}` : ''}
          </span>
        ) : null}
      </Button>
      <Button
        role="menuitem"
        variant="ghost"
        size="icon-sm"
        aria-label={`Edit ${props.action.name}`}
        onClick={props.onEdit}
        className="mr-1 opacity-50 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <Settings className="size-3" />
      </Button>
    </div>
  )
}

export function ProjectActionsMenu({ model, handlers }: ProjectActionsMenuProps) {
  return (
    <div className="w-72 p-1">
      {model.actions.map((action) => (
        <SavedActionMenuRow
          key={action.id}
          action={action}
          actions={model.actions}
          builtInBindings={model.builtInBindings}
          onRun={() => handlers.run(action)}
          onEdit={() => handlers.edit(action)}
        />
      ))}
      {model.candidates.length > 0 ? (
        <div className={model.actions.length > 0 ? 'mt-1 border-t border-border pt-1' : ''}>
          <div className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-text-muted">
            From t3.json
          </div>
          {model.candidates.map((candidate) => (
            <Button
              key={candidate.sourceIndex}
              role="menuitem"
              variant="row"
              size="xs"
              disabled={model.saving}
              onClick={() => handlers.importT3(candidate.sourceIndex)}
              className="min-w-0 gap-2"
            >
              <ProjectActionGlyph icon={candidate.icon} className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
              <Download className="size-3 shrink-0 text-text-muted" />
            </Button>
          ))}
        </div>
      ) : null}
      {model.discovery?.status === 'invalid' ? (
        <div role="alert" className="mx-1 my-1 rounded border border-warning/30 px-2 py-1.5">
          <div className="text-xs text-warning">Invalid t3.json</div>
          <div className="truncate text-xs text-text-muted">{model.discovery.error}</div>
        </div>
      ) : null}
      <Button
        role="menuitem"
        variant="row"
        size="xs"
        onClick={handlers.add}
        className="mt-1 gap-2 border-t border-border pt-2"
      >
        <Plus className="size-3.5" />
        Add action
      </Button>
    </div>
  )
}
