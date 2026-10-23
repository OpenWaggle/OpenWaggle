import type { BackgroundStartStatus } from './ipc-invoke-scheduled-tasks'
import type { ScheduledTasksCommand, ScheduledTasksOutcome } from './scheduled-task'

/** Renderer-facing Scheduled tasks and Background start API (ADR 0057). */
export interface OpenWaggleScheduledTasksApi {
  /** One `scheduled-tasks-v1` command through the Session Host. */
  executeScheduledTasks(
    command: ScheduledTasksCommand,
    idempotencyKey?: string,
  ): Promise<ScheduledTasksOutcome>
  getBackgroundStart(): Promise<BackgroundStartStatus>
  setBackgroundStart(enabled: boolean): Promise<BackgroundStartStatus>
}
