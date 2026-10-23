import { invoke } from './ipc-bindings'

/** Scheduled tasks and Background start (ADR 0057), kept beside api.ts for its line budget. */
export const scheduledTasksApi = {
  executeScheduledTasks: invoke('scheduled-tasks:execute'),
  getBackgroundStart: invoke('app:get-background-start'),
  setBackgroundStart: invoke('app:set-background-start'),
}
