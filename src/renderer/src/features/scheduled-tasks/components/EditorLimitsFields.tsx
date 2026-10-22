import type { ScheduledTaskNotificationPolicy } from '@shared/types/scheduled-task'
import { Select } from '@/shared/ui/Select'
import { TextInput } from '@/shared/ui/TextInput'
import type { ScheduledTaskEditorState } from '../hooks/useScheduledTaskEditor'
import { machineTimeZone, NOTIFICATION_POLICY_LABELS } from '../lib/task-format'
import { EditorField } from './EditorField'

function availableTimeZones(current: string) {
  const zones = new Set(
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [],
  )
  zones.add(machineTimeZone())
  zones.add(current)
  return [...zones].sort((left, right) => left.localeCompare(right))
}

function isNotificationPolicy(value: string): value is ScheduledTaskNotificationPolicy {
  return value === 'every-run' || value === 'failures-only'
}

/** Time zone, end date, run limit, and when the task notifies. */
export function EditorLimitsFields({ editor }: { readonly editor: ScheduledTaskEditorState }) {
  const { draft } = editor
  const machineZone = machineTimeZone()
  return (
    <div className="space-y-3">
      <EditorField
        label="Time zone"
        htmlFor="scheduled-task-time-zone"
        hint={
          draft.timeZone === machineZone
            ? 'This machine’s time zone. The task keeps it if the machine’s zone changes.'
            : `This machine uses ${machineZone}.`
        }
      >
        <Select
          id="scheduled-task-time-zone"
          className="w-full"
          value={draft.timeZone}
          onChange={(event) => editor.change({ timeZone: event.target.value })}
        >
          {availableTimeZones(draft.timeZone).map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </Select>
      </EditorField>
      <div className="grid grid-cols-2 gap-3">
        <EditorField label="End date" htmlFor="scheduled-task-end-date" hint="Optional.">
          <TextInput
            id="scheduled-task-end-date"
            type="date"
            inputSize="sm"
            value={draft.endDate}
            onChange={(event) => editor.change({ endDate: event.target.value })}
          />
        </EditorField>
        <EditorField label="Max runs" htmlFor="scheduled-task-max-runs" hint="Optional.">
          <TextInput
            id="scheduled-task-max-runs"
            inputSize="sm"
            inputMode="numeric"
            value={draft.maxRuns}
            onChange={(event) => editor.change({ maxRuns: event.target.value })}
          />
        </EditorField>
      </div>
      <EditorField label="Notify" htmlFor="scheduled-task-notify">
        <Select
          id="scheduled-task-notify"
          className="w-full"
          value={draft.notificationPolicy}
          onChange={(event) => {
            const value = event.target.value
            if (isNotificationPolicy(value)) editor.change({ notificationPolicy: value })
          }}
        >
          <option value="failures-only">{NOTIFICATION_POLICY_LABELS['failures-only']}</option>
          <option value="every-run">{NOTIFICATION_POLICY_LABELS['every-run']}</option>
        </Select>
      </EditorField>
    </div>
  )
}
