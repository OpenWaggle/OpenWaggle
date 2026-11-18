import type { IpcEventMethod, IpcInvokeMethod } from './ipc-api-methods'

/** The GUI's startup state, and what main passes the preload when it creates the window. */
export interface OpenWaggleStartupApi {
  /** The user's home directory, for display paths only (`~`); null when main passed none. */
  getHomeDirectory(): string | null
  getStartupStatus: IpcInvokeMethod<'app:get-startup-status'>
  retryStartup: IpcInvokeMethod<'app:retry-startup'>
  onStartupStatusChanged: IpcEventMethod<'app:startup-status-changed'>
}
