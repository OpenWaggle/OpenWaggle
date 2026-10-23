import type {
  LaunchScheduleWorkspace,
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskKind,
  ScheduledTaskNotificationPolicy,
  ScheduledTaskPatch,
  ScheduledTaskTarget,
} from '@shared/types/scheduled-task'
import { SCHEDULED_TASK_MAX_RUNS_LIMIT } from '@shared/types/scheduled-task'
import type { ThinkingLevel } from '@shared/types/settings'
import { addDays, isValidTimeZone, localDateOf, zonedEpoch } from '@shared/utils/zoned-time'
import {
  defaultScheduleDraft,
  draftFromSchedule,
  type ScheduleDraft,
  scheduleFromDraft,
} from './schedule-presets'
import { defaultNotificationPolicy } from './task-format'

/** Everything the Create/Edit editor holds, as the user typed it. */
export interface TaskEditorDraft {
  readonly name: string
  readonly prompt: string
  readonly kind: ScheduledTaskKind
  readonly enabled: boolean
  /** Heartbeat target. */
  readonly sessionId: string
  /** Launch schedule target. */
  readonly projectPath: string
  readonly workspace: LaunchScheduleWorkspace
  /** Empty means the project's default model. */
  readonly modelId: string
  readonly thinkingLevel: ThinkingLevel | ''
  readonly agentDefinitionName: string
  readonly archiveFinishedSessions: boolean
  readonly schedule: ScheduleDraft
  readonly timeZone: string
  /** `YYYY-MM-DD`, or empty for no end date. */
  readonly endDate: string
  /** Text as typed, or empty for no run limit. */
  readonly maxRuns: string
  readonly notificationPolicy: ScheduledTaskNotificationPolicy
}

export type TaskDraftResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string }

const DATE_PATTERN = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/
const INTEGER_PATTERN = /^\d+$/
const DATE_PART_LENGTH = 2

export function newTaskDraft(input: {
  readonly kind: ScheduledTaskKind
  readonly timeZone: string
  readonly sessionId?: string
  readonly projectPath?: string
}): TaskEditorDraft {
  return {
    name: '',
    prompt: '',
    kind: input.kind,
    enabled: true,
    sessionId: input.sessionId ?? '',
    projectPath: input.projectPath ?? '',
    workspace: 'new-worktree',
    modelId: '',
    thinkingLevel: '',
    agentDefinitionName: '',
    archiveFinishedSessions: false,
    schedule: defaultScheduleDraft(input.kind),
    timeZone: input.timeZone,
    endDate: '',
    maxRuns: '',
    notificationPolicy: defaultNotificationPolicy(input.kind),
  }
}

/** Switching kind while creating also switches the defaults that depend on it. */
export function withDraftKind(draft: TaskEditorDraft, kind: ScheduledTaskKind): TaskEditorDraft {
  if (draft.kind === kind) return draft
  return {
    ...draft,
    kind,
    schedule: defaultScheduleDraft(kind),
    notificationPolicy: defaultNotificationPolicy(kind),
  }
}

function pad(value: number) {
  return String(value).padStart(DATE_PART_LENGTH, '0')
}

/** The calendar day `endsAt` falls on in the task's own time zone. */
function endDateFromTimestamp(endsAt: number | null, timeZone: string) {
  if (endsAt === null) return ''
  const date = localDateOf(endsAt, timeZone)
  return `${String(date.year)}-${pad(date.month)}-${pad(date.day)}`
}

function launchDraftFields(target: ScheduledTaskTarget) {
  if (target.kind !== 'launch') return {} satisfies Partial<TaskEditorDraft>
  return {
    projectPath: target.projectPath,
    workspace: target.workspace,
    modelId: target.modelId ?? '',
    thinkingLevel: target.thinkingLevel ?? '',
    agentDefinitionName: target.agentDefinitionName ?? '',
    archiveFinishedSessions: target.archiveFinishedSessions,
  } satisfies Partial<TaskEditorDraft>
}

export function draftFromTask(task: ScheduledTask): TaskEditorDraft {
  const base = newTaskDraft({ kind: task.kind, timeZone: task.timeZone })
  return {
    ...base,
    ...launchDraftFields(task.target),
    name: task.name,
    prompt: task.prompt,
    enabled: task.enabled,
    sessionId: task.target.kind === 'heartbeat' ? task.target.sessionId : '',
    schedule: draftFromSchedule(task.schedule, task.kind),
    endDate: endDateFromTimestamp(task.endsAt, task.timeZone),
    maxRuns: task.maxRuns === null ? '' : String(task.maxRuns),
    notificationPolicy: task.notificationPolicy,
  }
}

function targetFromDraft(draft: TaskEditorDraft): TaskDraftResult<ScheduledTaskTarget> {
  if (draft.kind === 'heartbeat') {
    if (draft.sessionId === '') return { ok: false, error: 'Choose the Session to deliver into.' }
    return { ok: true, value: { kind: 'heartbeat', sessionId: draft.sessionId } }
  }
  if (draft.projectPath === '') return { ok: false, error: 'Choose a project.' }
  const agentDefinitionName = draft.agentDefinitionName.trim()
  return {
    ok: true,
    value: {
      kind: 'launch',
      projectPath: draft.projectPath,
      workspace: draft.workspace,
      ...(draft.modelId ? { modelId: draft.modelId } : {}),
      ...(draft.thinkingLevel ? { thinkingLevel: draft.thinkingLevel } : {}),
      ...(agentDefinitionName ? { agentDefinitionName } : {}),
      archiveFinishedSessions: draft.archiveFinishedSessions,
    },
  }
}

/** The last moment of the chosen day on the task's own time zone clock. */
export function endsAtFromDraft(endDate: string, timeZone: string): TaskDraftResult<number | null> {
  if (endDate === '') return { ok: true, value: null }
  const match = DATE_PATTERN.exec(endDate)
  if (!match || !isValidTimeZone(timeZone)) return { ok: false, error: 'Choose a valid end date.' }
  const day = {
    year: Number(match.groups?.year),
    month: Number(match.groups?.month),
    day: Number(match.groups?.day),
  }
  const nextMidnight = zonedEpoch(addDays(day, 1), 0, 0, timeZone)
  if (Number.isNaN(nextMidnight)) return { ok: false, error: 'Choose a valid end date.' }
  return { ok: true, value: nextMidnight - 1 }
}

function maxRunsFromDraft(maxRuns: string): TaskDraftResult<number | null> {
  const trimmed = maxRuns.trim()
  if (trimmed === '') return { ok: true, value: null }
  const count = INTEGER_PATTERN.test(trimmed) ? Number(trimmed) : 0
  if (count < 1 || count > SCHEDULED_TASK_MAX_RUNS_LIMIT) {
    return { ok: false, error: 'Max runs must be a whole number of at least 1.' }
  }
  return { ok: true, value: count }
}

const NAME_WORD_LIMIT = 6
const NAME_LENGTH_LIMIT = 60

/** A task name from the start of its prompt, used until the user names the task. */
export function nameFromPrompt(prompt: string) {
  const firstLine = prompt.trim().split('\n')[0] ?? ''
  const words = firstLine
    .replace(/[.!?:;,]+$/u, '')
    .split(/\s+/u)
    .filter(Boolean)
  // A first line of only punctuation still names the task, rather than leaving no name.
  if (words.length === 0) return firstLine.slice(0, NAME_LENGTH_LIMIT)
  const name = words.slice(0, NAME_WORD_LIMIT).join(' ')
  const trimmed =
    name.length > NAME_LENGTH_LIMIT ? name.slice(0, NAME_LENGTH_LIMIT).trimEnd() : name
  return words.length > NAME_WORD_LIMIT || name.length > NAME_LENGTH_LIMIT ? `${trimmed}…` : trimmed
}

/** The create input an editor draft describes, or the first reason it does not yet. */
export function taskInputFromDraft(draft: TaskEditorDraft): TaskDraftResult<ScheduledTaskInput> {
  if (draft.prompt.trim() === '') return { ok: false, error: 'Write the prompt to deliver.' }
  const target = targetFromDraft(draft)
  if (!target.ok) return target
  const schedule = scheduleFromDraft(draft.schedule, draft.kind)
  if (!schedule.ok) return { ok: false, error: schedule.error }
  const endsAt = endsAtFromDraft(draft.endDate, draft.timeZone)
  if (!endsAt.ok) return endsAt
  const maxRuns = maxRunsFromDraft(draft.maxRuns)
  if (!maxRuns.ok) return maxRuns
  return {
    ok: true,
    value: {
      name: draft.name.trim() || nameFromPrompt(draft.prompt),
      prompt: draft.prompt,
      enabled: draft.enabled,
      schedule: schedule.schedule,
      timeZone: draft.timeZone,
      endsAt: endsAt.value,
      maxRuns: maxRuns.value,
      target: target.value,
      notificationPolicy: draft.notificationPolicy,
    },
  }
}

/** The update patch for an edited task; a Heartbeat's target Session cannot change. */
export function taskPatchFromDraft(draft: TaskEditorDraft): TaskDraftResult<ScheduledTaskPatch> {
  const input = taskInputFromDraft(draft)
  if (!input.ok) return input
  const { target, ...rest } = input.value
  return { ok: true, value: target.kind === 'heartbeat' ? rest : { ...rest, target } }
}
