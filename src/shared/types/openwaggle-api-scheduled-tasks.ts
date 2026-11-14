import type { IpcInvokeMethod } from './ipc-api-methods'

/** Renderer-facing Scheduled tasks and Background start API (ADR 0057). */
export interface OpenWaggleScheduledTasksApi {
  /** One `scheduled-tasks-v1` command through the Session Host. */
  executeScheduledTasks: IpcInvokeMethod<'scheduled-tasks:execute'>
  getBackgroundStart: IpcInvokeMethod<'app:get-background-start'>
  setBackgroundStart: IpcInvokeMethod<'app:set-background-start'>
}
