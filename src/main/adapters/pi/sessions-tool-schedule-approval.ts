import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from '@shared/types/local-session-protocol'
import type { ScheduledTask } from '@shared/types/scheduled-task'
import type { SessionsToolSource } from './sessions-tool-payload'
import { scheduledTasksPayload } from './sessions-tool-schedule-command'
import {
  executeSessionsToolSchedule,
  type SessionsToolScheduleInput,
} from './sessions-tool-schedule-payload'

function approvalMessage(task: ScheduledTask, command: string) {
  return [
    `Heartbeat: ${task.name}`,
    'Before each firing, the Session Host runs this command in the Session workspace with your access, and starts the agent Run only when it exits non-zero or prints something:',
    '',
    command,
    '',
    'Approve it once; a changed command asks again. Until you approve it, the Heartbeat waits, and you can approve it later from its Scheduled task.',
  ].join('\n')
}

/** The task a create or update returned, with a Wake check that waits for the user's approval. */
function pendingWakeCheck(result: LocalSessionCommandResult) {
  if (result.contract !== 'scheduled-tasks-v1') return null
  const outcome = result.response.outcome
  if (outcome.effect !== 'created' && outcome.effect !== 'updated') return null
  const wakeCheck = outcome.task.heartbeat?.wakeCheck
  if (wakeCheck?.approval !== 'pending') return null
  return { result, effect: outcome.effect, task: outcome.task, command: wakeCheck.command }
}

/**
 * A Heartbeat whose Session asks for approval runs an agent-set Wake check only once the user
 * approved that exact command (#388). The approval is asked here, in the Session, with a plain
 * confirmation that no Authorization mode may answer for the user; only a yes sends the approval.
 * The result stays the create or update the agent asked for, now showing the approved task.
 */
export async function approvePendingWakeCheck(input: {
  readonly result: LocalSessionCommandResult
  readonly ctx: ExtensionContext
  readonly send: (payload: LocalSessionCommandPayload) => Promise<LocalSessionCommandResult>
  readonly signal?: AbortSignal
}): Promise<LocalSessionCommandResult> {
  const pending = pendingWakeCheck(input.result)
  if (!pending || !input.ctx.hasUI) return input.result
  const approved = await input.ctx.ui.confirm(
    'Approve this Heartbeat’s Wake check?',
    approvalMessage(pending.task, pending.command),
    { signal: input.signal },
  )
  if (!approved) return input.result
  const approval = await input.send(
    scheduledTasksPayload({
      operation: 'approve-wake-check',
      taskId: pending.task.id,
      command: pending.command,
    }),
  )
  if (approval.contract !== 'scheduled-tasks-v1') return input.result
  const outcome = approval.response.outcome
  if (outcome.effect !== 'updated') return input.result
  return {
    ...pending.result,
    response: {
      ...pending.result.response,
      outcome: { effect: pending.effect, task: outcome.task },
    },
  }
}

/** One Scheduled task action of the hive tool, with the user's Wake check approval if it needs one. */
export async function executeScheduleToolAction(input: {
  readonly params: SessionsToolScheduleInput
  readonly source: SessionsToolSource
  readonly ctx: ExtensionContext
  readonly send: (payload: LocalSessionCommandPayload) => Promise<LocalSessionCommandResult>
  readonly signal?: AbortSignal
}) {
  return approvePendingWakeCheck({
    result: await executeSessionsToolSchedule(input.params, input.source, input.send),
    ctx: input.ctx,
    send: input.send,
    ...(input.signal ? { signal: input.signal } : {}),
  })
}
