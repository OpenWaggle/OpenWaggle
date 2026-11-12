import { appLifecycle } from '../desktop-shell/app-lifecycle'
import { appPaths } from '../desktop-shell/app-paths'
import {
  configureUsageStatisticsGuiRecorder,
  flushUsageStatisticsSync,
  recordUsageStatistics,
} from './usage-statistics-recorder'

let quitFlushRegistered = false

/**
 * Starts recording what only the GUI main process observes. Called once per GUI process when
 * its IPC surface is registered, which is after Settings were hydrated from the Session Host.
 * Observations still waiting for their debounced write are saved when the app quits.
 */
export function startGuiUsageStatistics(): void {
  configureUsageStatisticsGuiRecorder({ userDataDirectory: appPaths.userData() })
  if (!quitFlushRegistered) {
    quitFlushRegistered = true
    appLifecycle.onWillQuit(flushUsageStatisticsSync)
  }
  recordUsageStatistics({ kind: 'app-opened' })
}
