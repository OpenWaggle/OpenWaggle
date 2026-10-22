import { ISO_WEEKDAYS, type IsoWeekday } from '@shared/types/scheduled-task'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Select } from '@/shared/ui/Select'
import { TextInput } from '@/shared/ui/TextInput'
import type { ScheduledTaskEditorState } from '../hooks/useScheduledTaskEditor'
import {
  type IntervalUnit,
  minimumIntervalMinutes,
  type SchedulePreset,
  WEEKDAY_SHORT_LABELS,
} from '../lib/schedule-presets'
import { EditorField } from './EditorField'

const PRESET_OPTIONS: readonly { value: SchedulePreset; label: string }[] = [
  { value: 'interval', label: 'Every N minutes or hours' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly on chosen days' },
  { value: 'rrule', label: 'Advanced (recurrence rule)' },
]

function isPreset(value: string): value is SchedulePreset {
  return PRESET_OPTIONS.some((option) => option.value === value)
}

function isIntervalUnit(value: string): value is IntervalUnit {
  return value === 'minutes' || value === 'hours'
}

function toggledWeekdays(weekdays: readonly IsoWeekday[], day: IsoWeekday, on: boolean) {
  return on
    ? [...weekdays.filter((value) => value !== day), day]
    : weekdays.filter((value) => value !== day)
}

function IntervalFields({ editor }: { readonly editor: ScheduledTaskEditorState }) {
  const { schedule, kind } = editor.draft
  return (
    <EditorField
      label="Every"
      htmlFor="scheduled-task-interval"
      hint={`At most every ${String(minimumIntervalMinutes(kind))} minutes.`}
    >
      <div className="flex gap-2">
        <TextInput
          id="scheduled-task-interval"
          inputSize="sm"
          inputMode="numeric"
          className="w-24"
          value={schedule.intervalAmount}
          onChange={(event) => editor.changeSchedule({ intervalAmount: event.target.value })}
        />
        <Select
          aria-label="Interval unit"
          value={schedule.intervalUnit}
          onChange={(event) => {
            const value = event.target.value
            if (isIntervalUnit(value)) editor.changeSchedule({ intervalUnit: value })
          }}
        >
          <option value="minutes">minutes</option>
          <option value="hours">hours</option>
        </Select>
      </div>
    </EditorField>
  )
}

function WeekdayPicker({ editor }: { readonly editor: ScheduledTaskEditorState }) {
  const { weekdays } = editor.draft.schedule
  return (
    <EditorField label="On">
      <div className="flex flex-wrap gap-3">
        {ISO_WEEKDAYS.map((day) => (
          <Checkbox
            key={day}
            label={WEEKDAY_SHORT_LABELS[day]}
            checked={weekdays.includes(day)}
            onChange={(event) =>
              editor.changeSchedule({
                weekdays: toggledWeekdays(weekdays, day, event.target.checked),
              })
            }
          />
        ))}
      </div>
    </EditorField>
  )
}

function TimeField({ editor }: { readonly editor: ScheduledTaskEditorState }) {
  return (
    <EditorField label="At" htmlFor="scheduled-task-time">
      <TextInput
        id="scheduled-task-time"
        type="time"
        inputSize="sm"
        className="w-32"
        value={editor.draft.schedule.time}
        onChange={(event) => editor.changeSchedule({ time: event.target.value })}
      />
    </EditorField>
  )
}

function RuleField({ editor }: { readonly editor: ScheduledTaskEditorState }) {
  return (
    <EditorField
      label="Recurrence rule"
      htmlFor="scheduled-task-rrule"
      hint="An RFC 5545 rule without DTSTART, UNTIL or COUNT, e.g. FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0."
    >
      <TextInput
        id="scheduled-task-rrule"
        inputSize="sm"
        monospace
        value={editor.draft.schedule.rule}
        placeholder="FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0"
        onChange={(event) => editor.changeSchedule({ rule: event.target.value })}
      />
    </EditorField>
  )
}

/** The Task schedule presets; each maps to exactly one stored Task schedule. */
export function EditorScheduleFields({ editor }: { readonly editor: ScheduledTaskEditorState }) {
  const { preset } = editor.draft.schedule
  return (
    <div className="space-y-3">
      <EditorField label="Repeat" htmlFor="scheduled-task-preset">
        <Select
          id="scheduled-task-preset"
          className="w-full"
          value={preset}
          onChange={(event) => {
            const value = event.target.value
            if (isPreset(value)) editor.changeSchedule({ preset: value })
          }}
        >
          {PRESET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </EditorField>
      {preset === 'interval' ? <IntervalFields editor={editor} /> : null}
      {preset === 'weekly' ? <WeekdayPicker editor={editor} /> : null}
      {preset === 'daily' || preset === 'weekdays' || preset === 'weekly' ? (
        <TimeField editor={editor} />
      ) : null}
      {preset === 'rrule' ? <RuleField editor={editor} /> : null}
    </div>
  )
}
