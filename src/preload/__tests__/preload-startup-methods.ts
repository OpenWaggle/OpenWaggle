import { PRELOAD_SCHEDULED_TASKS_METHODS } from './preload-scheduled-tasks-methods'

/** Scheduled tasks, Background start, the window's startup state (A-F2) and the first launch. */
export const PRELOAD_APP_LIFECYCLE_METHODS = [
  ...PRELOAD_SCHEDULED_TASKS_METHODS,
  'getHomeDirectory',
  'getTrustedOriginBases',
  'sendErrorReportEnvelope',
  'getStartupStatus',
  'retryStartup',
  'onStartupStatusChanged',
  'getElectronMigrationNotice',
  'continueElectronSecretsMigration',
  'skipElectronSecretsMigration',
] as const
