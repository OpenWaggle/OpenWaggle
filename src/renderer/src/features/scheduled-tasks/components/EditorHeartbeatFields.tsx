import {
  HEARTBEAT_IDLE_PAUSE_MAX,
  HEARTBEAT_IDLE_PAUSE_MIN,
  HEARTBEAT_STOP_WHEN_MAX_LENGTH,
  HEARTBEAT_WAKE_CHECK_MAX_LENGTH,
  type HeartbeatWakeCheckFailurePolicy,
} from '@shared/types/scheduled-task'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Select } from '@/shared/ui/Select'
import { TextInput } from '@/shared/ui/TextInput'
import type { ScheduledTaskEditorState } from '../hooks/useScheduledTaskEditor'
import { EditorField } from './EditorField'

function isFailurePolicy(value: string): value is HeartbeatWakeCheckFailurePolicy {
  return value === 'wake' || value === 'skip'
}

/** "Stop when…": every Heartbeat needs a way to finish. */
export function EditorStopFields({ editor }: { readonly editor: ScheduledTaskEditorState }) {
  const { draft } = editor
  return (
    <div className="space-y-2">
      <TextInput
        id="scheduled-task-stop-when"
        aria-label="Stop when…"
        inputSize="sm"
        maxLength={HEARTBEAT_STOP_WHEN_MAX_LENGTH}
        value={draft.stopWhen}
        placeholder="Stop when… e.g. PR #42 is merged and main is green"
        onChange={(event) => editor.change({ stopWhen: event.target.value })}
      />
      <Checkbox
        label="Runs indefinitely"
        labelClassName="text-xs"
        checked={draft.indefinite}
        onChange={(event) => editor.change({ indefinite: event.target.checked })}
      />
      <p className="text-xs text-text-tertiary">
        Its Run reads this and pauses the Heartbeat once it is met. Or set an end date or a run
        limit below, or let it run indefinitely.
      </p>
    </div>
  )
}

/** The Wake check and idle Auto-pause: what keeps an idle Heartbeat from spending tokens. */
export function EditorWakeCheckFields({ editor }: { readonly editor: ScheduledTaskEditorState }) {
  const { draft } = editor
  return (
    <div className="space-y-3">
      <EditorField
        label="Wake check"
        htmlFor="scheduled-task-wake-check"
        hint="Optional. Runs first in the Session’s workspace; the Run starts only if it exits non-zero or prints something. Otherwise the firing is skipped, with no model call. Saving approves this command."
      >
        <TextInput
          id="scheduled-task-wake-check"
          inputSize="sm"
          monospace
          maxLength={HEARTBEAT_WAKE_CHECK_MAX_LENGTH}
          value={draft.wakeCommand}
          placeholder="gh pr checks 42 | grep -i fail"
          onChange={(event) => editor.change({ wakeCommand: event.target.value })}
        />
      </EditorField>
      <div className="grid grid-cols-2 gap-3">
        <EditorField label="If the check fails" htmlFor="scheduled-task-wake-on-failure">
          <Select
            id="scheduled-task-wake-on-failure"
            className="w-full"
            value={draft.wakeOnFailure}
            disabled={draft.wakeCommand.trim() === ''}
            onChange={(event) => {
              const value = event.target.value
              if (isFailurePolicy(value)) editor.change({ wakeOnFailure: value })
            }}
          >
            <option value="wake">Wake the Run</option>
            <option value="skip">Skip the firing</option>
          </Select>
        </EditorField>
        <EditorField label="Pause after idle runs" htmlFor="scheduled-task-idle-pause">
          <TextInput
            id="scheduled-task-idle-pause"
            type="number"
            inputSize="sm"
            inputMode="numeric"
            min={HEARTBEAT_IDLE_PAUSE_MIN}
            max={HEARTBEAT_IDLE_PAUSE_MAX}
            value={draft.idlePauseAfter}
            onChange={(event) => editor.change({ idlePauseAfter: event.target.value })}
          />
        </EditorField>
      </div>
    </div>
  )
}
