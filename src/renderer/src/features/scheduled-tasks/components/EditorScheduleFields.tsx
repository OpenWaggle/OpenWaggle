import { ISO_WEEKDAYS, type IsoWeekday } from '@shared/types/scheduled-task'
import { machineTimeZone } from '@shared/utils/zoned-time'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Select } from '@/shared/ui/Select'
import { TextInput } from '@/shared/ui/TextInput'
import { useNow } from '../hooks/useNow'
import type { ScheduledTaskEditorState } from '../hooks/useScheduledTaskEditor'
import {
  type IntervalUnit,
  minimumIntervalMinutes,
  type SchedulePreset,
  scheduleFromDraft,
  WEEKDAY_SHORT_LABELS,
} from '../lib/schedule-presets'
import { previewSchedule } from '../lib/schedule-preview'
import { endsAtFromDraft } from '../lib/task-draft'
import { formatPreviewTime } from '../lib/task-format'
import { EditorField } from './EditorField'

const PRESET_OPTIONS: readonly { value: SchedulePreset; label: string }[] = [
  { value: 'interval', label: 'Every…' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'On chosen days' },
  { value: 'rrule', label: 'Custom rule' },
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
  const { schedule } = editor.draft
  return (
    <>
      <div className="w-16">
        <TextInput
          id="scheduled-task-interval"
          aria-label="Interval"
          inputSize="sm"
          inputMode="numeric"
          value={schedule.intervalAmount}
          onChange={(event) => editor.changeSchedule({ intervalAmount: event.target.value })}
        />
      </div>
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
    </>
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
    <>
      <span className="text-xs text-text-tertiary">at</span>
      <div className="w-28">
        <TextInput
          id="scheduled-task-time"
          aria-label="Time of day"
          type="time"
          inputSize="sm"
          value={editor.draft.schedule.time}
          onChange={(event) => editor.changeSchedule({ time: event.target.value })}
        />
      </div>
    </>
  )
}

function availableTimeZones(current: string) {
  const zones = new Set(
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [],
  )
  zones.add(machineTimeZone())
  zones.add(current)
  return [...zones].sort((left, right) => left.localeCompare(right))
}

function timeZoneHint(timeZone: string) {
  const machine = machineTimeZone()
  return timeZone === machine
    ? 'This machine’s time zone. Times stay on its clock even if the machine’s zone changes.'
    : `This machine uses ${machine}. Times are read on ${timeZone}’s clock.`
}

function TimeZoneField({ editor }: { readonly editor: ScheduledTaskEditorState }) {
  return (
    <Select
      id="scheduled-task-time-zone"
      aria-label="Time zone"
      title={timeZoneHint(editor.draft.timeZone)}
      value={editor.draft.timeZone}
      onChange={(event) => editor.change({ timeZone: event.target.value })}
    >
      {availableTimeZones(editor.draft.timeZone).map((zone) => (
        <option key={zone} value={zone}>
          {zone}
        </option>
      ))}
    </Select>
  )
}

/** The next fire times the draft would have, or why it would not fire. */
function SchedulePreviewLine({ editor }: { readonly editor: ScheduledTaskEditorState }) {
  const now = useNow()
  const { draft } = editor
  const schedule = scheduleFromDraft(draft.schedule, draft.kind)
  const endsAt = endsAtFromDraft(draft.endDate, draft.timeZone)
  const preview = schedule.ok
    ? previewSchedule({
        kind: draft.kind,
        schedule: schedule.schedule,
        timeZone: draft.timeZone,
        endsAt: endsAt.ok ? endsAt.value : null,
        now,
        stored: editor.original,
      })
    : { ok: false as const, error: schedule.error }
  if (!preview.ok) {
    return <p className="text-xs text-warning">{preview.error}</p>
  }
  const zone = draft.timeZone === machineTimeZone() ? null : draft.timeZone
  return (
    <div aria-live="polite" className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-text-tertiary">Next</span>
      {preview.times.length === 0 ? (
        <span className="text-text-tertiary">no more runs before the end date</span>
      ) : (
        preview.times.map((time) => (
          <span
            key={time}
            className="rounded bg-bg-hover px-1.5 py-0.5 tabular-nums text-text-secondary"
          >
            {formatPreviewTime(time, now, zone)}
          </span>
        ))
      )}
      {preview.jittered ? <span className="text-text-tertiary">± up to 5 min</span> : null}
    </div>
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

/** When the task fires: a preset, its time, the zone it is read in, and the next runs. */
export function EditorScheduleFields({ editor }: { readonly editor: ScheduledTaskEditorState }) {
  const { preset } = editor.draft.schedule
  const timed = preset === 'daily' || preset === 'weekdays' || preset === 'weekly'
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          id="scheduled-task-preset"
          aria-label="Repeat"
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
        {preset === 'interval' ? <IntervalFields editor={editor} /> : null}
        {timed ? <TimeField editor={editor} /> : null}
        <TimeZoneField editor={editor} />
      </div>
      {preset === 'weekly' ? <WeekdayPicker editor={editor} /> : null}
      {preset === 'rrule' ? <RuleField editor={editor} /> : null}
      <SchedulePreviewLine editor={editor} />
      <p className="text-xs text-text-tertiary">
        {preset === 'interval'
          ? `At most every ${String(minimumIntervalMinutes(editor.draft.kind))} minutes. `
          : null}
        {editor.draft.kind === 'heartbeat'
          ? 'If the Session is busy, it waits and checks again each minute.'
          : 'If the last run’s Session is still working, that firing is skipped.'}
      </p>
    </div>
  )
}
