import { isMatching, P } from '@diegogbrisa/ts-match'
import type { JsonObject } from '@shared/types/json'
import { parseSerializedToolPayload } from '@shared/utils/tool-result-state'
import { getToolResultDetails, getToolResultText } from './tool-call-block'
import { stringArg } from './tool-label-parts'

/** The sessions-tool actions over Scheduled tasks (`sessions-tool-schedule-parameters.ts`). */
const SCHEDULE_ACTIONS = [
  'schedule_list',
  'schedule_read',
  'schedule_runs',
  'schedule_create',
  'schedule_update',
  'schedule_delete',
  'schedule_run_now',
] as const
export type SessionsToolScheduleAction = (typeof SCHEDULE_ACTIONS)[number]

/** The actions whose row carries the task's Open, Pause/Resume and Delete controls. */
const CONTROLLED_ACTIONS: ReadonlySet<SessionsToolScheduleAction> = new Set([
  'schedule_create',
  'schedule_update',
])

/** The Scheduled task one sessions-tool call acts on, as far as its result and arguments say. */
export interface SessionsToolScheduledTask {
  readonly action: SessionsToolScheduleAction
  readonly taskId: string | null
  readonly name: string | null
  /** The row offers the task's controls: the call created or changed it. */
  readonly controlled: boolean
  /** The Host's explanation when it refused the call. */
  readonly refusal: string | null
}

const namedTaskPattern = { id: P.string, name: P.string }

/** `details`: the Host's full `scheduled-tasks-v1` response, whose outcome names the task. */
const detailsTaskPattern = {
  contract: 'scheduled-tasks-v1',
  response: { outcome: { task: namedTaskPattern } },
}
const detailsDeletedPattern = {
  contract: 'scheduled-tasks-v1',
  response: { outcome: { effect: 'deleted', taskId: P.string } },
}

/** The compact text result the model read: `{ operation, effect, task: { id, name, ... } }`. */
const textTaskPattern = { task: namedTaskPattern }
const textDeletedPattern = { effect: 'deleted', taskId: P.string }
const detailsRejectedPattern = {
  contract: 'scheduled-tasks-v1',
  response: { outcome: { effect: 'rejected', message: P.string } },
}
const textRejectedPattern = { effect: 'rejected', message: P.string }

export function sessionsToolScheduleAction(args: JsonObject): SessionsToolScheduleAction | null {
  const action = stringArg(args, 'action')
  return SCHEDULE_ACTIONS.find((candidate) => candidate === action) ?? null
}

function nonEmpty(value: string) {
  return value.trim() ? value : null
}

function resultRefusal(resultContent: unknown) {
  if (resultContent === undefined) return null
  const details = getToolResultDetails(resultContent)
  if (isMatching(detailsRejectedPattern, details)) return details.response.outcome.message
  const text = parseSerializedToolPayload(getToolResultText(resultContent))
  return isMatching(textRejectedPattern, text) ? text.message : null
}

function resultTask(resultContent: unknown) {
  if (resultContent === undefined) return null
  const details = getToolResultDetails(resultContent)
  if (isMatching(detailsTaskPattern, details)) {
    const { task } = details.response.outcome
    return { taskId: nonEmpty(task.id), name: nonEmpty(task.name) }
  }
  if (isMatching(detailsDeletedPattern, details)) {
    return { taskId: nonEmpty(details.response.outcome.taskId), name: null }
  }
  // A result without details, as an older Host or a script's call records it.
  const text = parseSerializedToolPayload(getToolResultText(resultContent))
  if (isMatching(textTaskPattern, text)) {
    return { taskId: nonEmpty(text.task.id), name: nonEmpty(text.task.name) }
  }
  if (isMatching(textDeletedPattern, text)) {
    return { taskId: nonEmpty(text.taskId), name: null }
  }
  return null
}

/**
 * The task a Scheduled task action acts on: the one its result names, else the one its arguments
 * name (a create names only the task's name, every other action its id). A call still running,
 * refused, or made inside a script falls back to its arguments.
 */
export function sessionsToolScheduledTask(
  args: JsonObject,
  resultContent: unknown,
): SessionsToolScheduledTask | null {
  const action = sessionsToolScheduleAction(args)
  if (action === null) return null
  const fromResult = resultTask(resultContent)
  return {
    action,
    taskId: fromResult?.taskId ?? stringArg(args, 'scheduleTaskId'),
    name: fromResult?.name ?? stringArg(args, 'name'),
    controlled: CONTROLLED_ACTIONS.has(action),
    refusal: resultRefusal(resultContent),
  }
}
