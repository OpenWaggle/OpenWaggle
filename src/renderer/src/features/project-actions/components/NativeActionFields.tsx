import type { ActionDefinition, ActionStorage } from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import { useId } from 'react'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'
import { ActionBehaviorFields, ActionPreviewFields } from './ActionExecutionFields'
import { ActionDirectoryFields, ActionInvocationFields } from './ActionInvocationFields'
import { ActionTaskPicker } from './ActionTaskPicker'
import { ProjectActionIconPicker } from './ProjectActionIconPicker'

export function NativeActionFields({
  scope,
  action,
  storage,
  onChange,
  onStorageChange,
}: {
  readonly scope: ActionManagementScope
  readonly action: ActionDefinition
  readonly storage: ActionStorage
  readonly onChange: (patch: Partial<ActionDefinition>) => void
  readonly onStorageChange: (storage: ActionStorage) => void
}) {
  const id = useId()
  return (
    <div className="space-y-5 p-5">
      <ActionTaskPicker
        scope={scope}
        onChoose={(invocation, name) => onChange({ invocation, name: action.name || name })}
      />
      <label htmlFor={`${id}-name`} className="block space-y-1.5 text-xs text-text-secondary">
        <span>Name</span>
        <TextInput
          id={`${id}-name`}
          value={action.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="e.g. Development server"
          required
        />
      </label>
      <ActionInvocationFields
        scope={scope}
        invocation={action.invocation}
        onChange={(invocation) => onChange({ invocation })}
      />
      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs text-text-secondary">Save to</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(['local', 'project'] as const).map((option) => (
            <Button
              key={option}
              variant={storage === option ? 'accent' : 'secondary'}
              aria-pressed={storage === option}
              className="min-h-11 justify-start p-3"
              onClick={() => onStorageChange(option)}
            >
              {option === 'local' ? 'Only on this device' : 'In the project'}
            </Button>
          ))}
        </div>
        <p className="break-words text-xs text-text-tertiary">
          {storage === 'local'
            ? 'Private to you, for this project.'
            : 'Saved in .openwaggle/actions.json. Share it with your repository.'}
        </p>
      </fieldset>
      <details className="border-t border-border pt-3">
        <summary className="cursor-pointer text-xs text-text-secondary">More options</summary>
        <div className="mt-4 space-y-4">
          <ActionDirectoryFields
            invocation={action.invocation}
            onChange={(invocation) => onChange({ invocation })}
          />
          <ProjectActionIconPicker selected={action.icon} onSelect={(icon) => onChange({ icon })} />
          <ActionBehaviorFields action={action} onChange={onChange} />
          <ActionPreviewFields action={action} onChange={onChange} />
        </div>
      </details>
    </div>
  )
}
