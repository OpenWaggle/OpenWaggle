import type { ActionDefinition, ActionStorage } from '@shared/types/action-definitions'
import { useId } from 'react'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'
import { ActionBehaviorFields, ActionPreviewFields } from './ActionExecutionFields'
import { ActionInvocationFields } from './ActionInvocationFields'
import { ProjectActionIconPicker } from './ProjectActionIconPicker'

export function NativeActionFields({
  action,
  storage,
  onChange,
  onStorageChange,
  onChangeTask,
}: {
  readonly action: ActionDefinition
  readonly storage: ActionStorage
  readonly onChange: (patch: Partial<ActionDefinition>) => void
  readonly onStorageChange: (storage: ActionStorage) => void
  readonly onChangeTask: () => void
}) {
  const id = useId()
  const invocation = action.invocation
  return (
    <div className="space-y-5 p-5">
      <div className="space-y-3">
        <label htmlFor={`${id}-name`} className="space-y-1.5 text-xs text-text-secondary">
          <span>Name</span>
          <TextInput
            id={`${id}-name`}
            value={action.name}
            onChange={(event) => onChange({ name: event.target.value })}
            placeholder="e.g. Development server"
            required
          />
        </label>
        <ProjectActionIconPicker selected={action.icon} onSelect={(icon) => onChange({ icon })} />
      </div>
      <ActionInvocationFields
        invocation={invocation}
        onChange={(invocation) => onChange({ invocation })}
        onChangeTask={onChangeTask}
      />
      <ActionBehaviorFields action={action} onChange={onChange} />
      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs text-text-secondary">Save for this project</legend>
        <div className="grid grid-cols-2 gap-2">
          {(['local', 'project'] as const).map((option) => (
            <Button
              key={option}
              variant={storage === option ? 'accent' : 'secondary'}
              aria-pressed={storage === option}
              className="min-h-14 flex-col items-start p-3"
              onClick={() => onStorageChange(option)}
            >
              <span className="text-sm">
                {option === 'local' ? 'Only on this device' : 'Share in project'}
              </span>
              <span className="text-xs font-normal text-text-tertiary">
                {option === 'local' ? 'Private · this project only' : '.openwaggle/actions.json'}
              </span>
            </Button>
          ))}
        </div>
      </fieldset>
      <ActionPreviewFields action={action} onChange={onChange} />
    </div>
  )
}
