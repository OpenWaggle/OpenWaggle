import type { ActionCatalog, ActionDefinition } from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import type { ActionRun } from '@shared/types/action-runs'
import { useNavigate } from '@tanstack/react-router'
import { Plus, Settings2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { useActionAvailability } from '../hooks/useActionAvailability'
import { ProjectActionGlyph } from './ProjectActionGlyph'
export function NativeActionsMenu(props: {
  readonly scope: ActionManagementScope
  readonly actions: ActionCatalog['actions']
  readonly runs: readonly ActionRun[]
  readonly error?: string
  readonly canAdd: boolean
  readonly run: (definition: ActionDefinition) => Promise<unknown>
  readonly onClose: () => void
  readonly onAdd: () => void
}) {
  const navigate = useNavigate()
  const availability = useActionAvailability(props.scope, props.actions, props.runs)
  return (
    <div className="w-64 p-1.5">
      <p className="px-2 py-1.5 text-xs text-text-tertiary">Run in this session’s workspace</p>
      {props.error ? (
        <p role="alert" className="px-2 py-2 text-xs text-error-text">
          {props.error}
        </p>
      ) : null}
      {props.actions.map(({ definition }) => {
        const unavailable = availability(definition)
        return (
          <Button
            key={definition.id}
            role="menuitem"
            variant="row"
            className="min-h-9 gap-2 px-2"
            disabled={Boolean(unavailable)}
            title={unavailable}
            onClick={() => {
              props.onClose()
              void props.run(definition)
            }}
          >
            <ProjectActionGlyph icon={definition.icon} />
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate">{definition.name}</span>
              {unavailable ? (
                <span className="block text-xs text-text-tertiary">{unavailable}</span>
              ) : null}
            </span>
            <span className="text-xs text-text-tertiary">{definition.kind}</span>
          </Button>
        )
      })}
      <div className="mt-1 border-t border-border pt-1">
        <Button
          role="menuitem"
          variant="row"
          className="min-h-9 px-2"
          disabled={!props.canAdd}
          onClick={() => {
            props.onClose()
            props.onAdd()
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
