/**
 * Scheduled tasks (ADR 0057, ADR 0058) and Background start IPC channels.
 *
 * Kept in their own map: the GUI reaches Scheduled tasks only through the Session Host's
 * `scheduled-tasks-v1` contract, so one channel carries every command and its outcome.
 */
import type { ScheduledTasksCommand, ScheduledTasksOutcome } from './scheduled-task'

/** Whether the Session Host starts, with no window, when the user logs in (CONTEXT.md). */
export interface BackgroundStartStatus {
  readonly supported: boolean
  readonly enabled: boolean
  /** Why Background start is unsupported or could not be changed. */
  readonly reason?: string
}

export interface IpcScheduledTasksInvokeChannelMap {
  'scheduled-tasks:execute': {
    args: [command: ScheduledTasksCommand, idempotencyKey?: string]
    return: ScheduledTasksOutcome
  }
  'app:get-background-start': {
    args: []
    return: BackgroundStartStatus
  }
  'app:set-background-start': {
    args: [enabled: boolean]
    return: BackgroundStartStatus
  }
}
