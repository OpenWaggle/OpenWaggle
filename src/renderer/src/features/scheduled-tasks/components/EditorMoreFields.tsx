import type { ScheduledTaskNotificationPolicy } from '@shared/types/scheduled-task'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import { TextInput } from '@/shared/ui/TextInput'
import type { ScheduledTaskEditorState } from '../hooks/useScheduledTaskEditor'
import { NOTIFICATION_POLICY_LABELS } from '../lib/task-format'
import { EditorField } from './EditorField'

function isNotificationPolicy(value: string): value is ScheduledTaskNotificationPolicy {
  return value === 'every-run' || value === 'failures-only'
}

/** With no end date or run limit, a Heartbeat still ends at its Stop condition. */
function noEndText(editor: ScheduledTaskEditorState) {
  const { draft } = editor
  if (draft.kind !== 'heartbeat' || draft.indefinite) return 'Never ends'
  return draft.stopWhen.trim() ? 'Ends at its Stop condition' : 'No end date or run limit'
}

function summary(editor: ScheduledTaskEditorState) {
  const { draft } = editor
  const ends = [
    draft.endDate ? `ends ${draft.endDate}` : null,
    draft.maxRuns.trim() ? `at most ${draft.maxRuns.trim()} runs` : null,
  ].filter((part): part is string => part !== null)
  const endText = ends.length > 0 ? ends.join(', ') : noEndText(editor)
  return `${endText} · Notifies on ${NOTIFICATION_POLICY_LABELS[draft.notificationPolicy].toLowerCase()}`
}

/** End date, run limit and notifications: rarely changed, so one collapsed line. */
export function EditorMoreFields({ editor }: { readonly editor: ScheduledTaskEditorState }) {
  const [open, setOpen] = useState(false)
  const { draft } = editor
  const Icon = open ? ChevronDown : ChevronRight
  return (
    <div className="space-y-3">
      <Button
        variant="unstyled"
        aria-expanded={open}
        aria-controls={open ? 'scheduled-task-more' : undefined}
        className="flex items-center gap-1 text-left text-xs text-text-secondary hover:text-text-primary"
        onClick={() => setOpen(!open)}
      >
        <Icon aria-hidden="true" className="size-3.5" />
        {summary(editor)}
      </Button>
      {open ? (
        <div id="scheduled-task-more" className="space-y-3 pl-4">
          <div className="grid grid-cols-2 gap-3">
            <EditorField label="End date" htmlFor="scheduled-task-end-date">
              <TextInput
                id="scheduled-task-end-date"
                type="date"
                inputSize="sm"
                value={draft.endDate}
                onChange={(event) => editor.change({ endDate: event.target.value })}
              />
            </EditorField>
            <EditorField label="Max runs" htmlFor="scheduled-task-max-runs">
              <TextInput
                id="scheduled-task-max-runs"
                inputSize="sm"
                inputMode="numeric"
                placeholder="No limit"
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
      ) : null}
    </div>
  )
}
