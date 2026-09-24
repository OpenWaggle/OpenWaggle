import type { ActionDefinition } from '@shared/types/action-definitions'
import { useId } from 'react'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'

interface Props {
  readonly action: ActionDefinition
  readonly onChange: (patch: Partial<ActionDefinition>) => void
}
export function ActionBehaviorFields({ action, onChange }: Props) {
  return (
    <>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs text-text-secondary">Run behavior</legend>
        <div className="grid grid-cols-2 gap-2">
          {(['task', 'service'] as const).map((kind) => (
            <Button
              key={kind}
              variant={action.kind === kind ? 'accent' : 'secondary'}
              aria-pressed={action.kind === kind}
              className="min-h-14 flex-col items-start p-3"
              onClick={() =>
                onChange({
                  kind,
                  allowConcurrent: kind === 'service' ? false : action.allowConcurrent,
                })
              }
            >
              <span className="text-sm">{kind === 'task' ? 'Task' : 'Service'}</span>
              <span className="text-xs font-normal text-text-tertiary">
                {kind === 'task' ? 'Finishes when done' : 'Keeps running'}
              </span>
            </Button>
          ))}
        </div>
      </fieldset>
      {action.kind === 'task' ? (
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-text-secondary">Allow concurrent runs</p>
            <p className="text-xs text-text-tertiary">
              Off by default. Running actions open their existing output.
            </p>
          </div>
          <ToggleSwitch
            checked={action.allowConcurrent}
            onCheckedChange={(allowConcurrent) => onChange({ allowConcurrent })}
            label="Allow concurrent runs"
          />
        </div>
      ) : null}
    </>
  )
}
export function ActionPreviewFields({ action, onChange }: Props) {
  const id = useId()
  return (
    <details className="border-t border-border pt-3">
      <summary className="cursor-pointer text-xs text-text-secondary">Preview preferences</summary>
      <div className="mt-3 space-y-3">
        <label htmlFor={`${id}-preview`} className="block space-y-1.5 text-xs text-text-secondary">
          <span>Preview URL override</span>
          <TextInput
            id={`${id}-preview`}
            value={action.previewUrl ?? ''}
            placeholder="Detect from server output"
            onChange={(event) => onChange({ previewUrl: event.target.value || undefined })}
          />
        </label>
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-secondary">Open preview when ready</span>
          <ToggleSwitch
            label="Open preview when ready"
            checked={action.autoOpenPreview}
            onCheckedChange={(autoOpenPreview) => onChange({ autoOpenPreview })}
          />
        </div>
      </div>
    </details>
  )
}
