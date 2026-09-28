import type { ActionCatalog, ActionDefinition } from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import { type ActionRun, isActiveActionRun } from '@shared/types/action-runs'
import { actionNameKey } from '@shared/utils/action-name'
import { useNavigate } from '@tanstack/react-router'
import { PencilLine, Plus, Settings2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { useActionAvailability } from '../hooks/useActionAvailability'
import { duplicateActionNames, duplicateNameHint } from '../lib/action-names'
import { continueDraftLabel, isDraftDirty } from '../lib/action-panel-drafts'
import { useActionPanelStore } from '../state/action-panel-store'
import { ProjectActionGlyph } from './ProjectActionGlyph'
export function NativeActionsMenu(props: {
  readonly scope: ActionManagementScope
  readonly actions: ActionCatalog['actions']
  readonly runs: readonly ActionRun[]
  readonly error?: string
  readonly canAdd: boolean
  readonly run: (definition: ActionDefinition) => Promise<unknown>
  readonly onClose: () => void
  readonly panel: { readonly onAdd: () => void; readonly onContinue: () => void }
}) {
  const navigate = useNavigate()
  const availability = useActionAvailability(props.scope, props.actions, props.runs)
  const draft = useActionPanelStore((state) => state.drafts[props.scope.projectPath])
  const unfinished = draft && isDraftDirty(draft) ? draft : null
  const duplicates = duplicateActionNames(props.actions)
  return (
    <div className="w-64 max-w-full p-1.5">
      <p className="px-2 py-1.5 text-xs text-text-tertiary">Run in this session’s workspace</p>
      {props.error ? (
        <p role="alert" className="px-2 py-2 text-xs text-error-text">
          {props.error}
        </p>
      ) : null}
      {!props.error && props.actions.length === 0 ? (
        <p className="px-2 py-2 text-xs text-text-tertiary">
          {props.canAdd ? 'No saved actions yet.' : 'Loading actions…'}
        </p>
      ) : null}
      {props.actions.map((entry) => {
        const { definition } = entry
        const hint = duplicates.has(actionNameKey(definition.name))
          ? duplicateNameHint(entry)
          : null
        const unavailable = availability(definition)
        const running = props.runs.some(
          (run) =>
            run.action.id === definition.id &&
            isActiveActionRun(run) &&
            !run.action.allowConcurrent,
        )
        return (
          <Button
            key={definition.id}
            role="menuitem"
            variant="row"
            className="min-h-9 gap-2 px-2"
            disabled={Boolean(unavailable)}
            title={unavailable}
            aria-label={running ? `Show output for ${definition.name}` : `Run ${definition.name}`}
            onClick={() => {
              props.onClose()
              void props.run(definition)
            }}
          >
            <ProjectActionGlyph icon={definition.icon} />
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate">
                {definition.name}
                {hint ? <span className="ml-1.5 text-xs text-text-tertiary">{hint}</span> : null}
              </span>
              {unavailable ? (
                <span className="block text-xs text-text-tertiary">{unavailable}</span>
              ) : null}
            </span>
            <span className="text-xs text-text-tertiary">{running ? 'Show output' : 'Run'}</span>
          </Button>
        )
      })}
      <div className="mt-1 border-t border-border pt-1">
        {unfinished ? (
          <Button
            role="menuitem"
            variant="row"
            className="min-h-9 px-2"
            disabled={!props.canAdd}
            onClick={() => {
              props.onClose()
              props.panel.onContinue()
            }}
          >
            <PencilLine className="size-3.5" />
            {continueDraftLabel(unfinished)}
          </Button>
        ) : null}
        <Button
          role="menuitem"
          variant="row"
          className="min-h-9 px-2"
          disabled={!props.canAdd}
          onClick={() => {
            props.onClose()
            props.panel.onAdd()
          }}
        >
          <Plus className="size-3.5" />
          Add action
        </Button>
        <Button
          role="menuitem"
          variant="row"
          className="min-h-9 px-2"
          onClick={() => {
            props.onClose()
            void navigate({ to: '/settings/$tab', params: { tab: 'actions' } })
          }}
        >
          <Settings2 className="size-3.5" />
          Manage actions
        </Button>
      </div>
    </div>
  )
}
