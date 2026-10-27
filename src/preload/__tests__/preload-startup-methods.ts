import { PRELOAD_SCHEDULED_TASKS_METHODS } from './preload-scheduled-tasks-methods'

/** Scheduled tasks, Background start and the window's startup state (A-F2). */
export const PRELOAD_APP_LIFECYCLE_METHODS = [
  ...PRELOAD_SCHEDULED_TASKS_METHODS,
  'getStartupStatus',
  'retryStartup',
  'onStartupStatusChanged',
] as const
