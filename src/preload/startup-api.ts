import { invoke, on } from './ipc-bindings'

/** The window's startup state and Retry (A-F2), kept beside api.ts for its line budget. */
export const startupApi = {
  getStartupStatus: invoke('app:get-startup-status'),
  retryStartup: invoke('app:retry-startup'),
  onStartupStatusChanged: on('app:startup-status-changed'),
}
