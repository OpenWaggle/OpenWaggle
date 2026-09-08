import { app } from 'electron'
import { completeAppRuntimeShutdown } from './application/app-runtime-shutdown'
import { showErrorBox } from './desktop-ui'
import { describeError } from './error-description'
import { createLogger } from './logger'

const logger = createLogger('app-quit-cleanup')

/** Keep the app alive after failed terminal cleanup so ownership can be retried. */
export function registerAppQuitCleanup(input: {
  readonly disposeAutoUpdater: () => void
  readonly persistActiveRuns: () => Promise<void>
  readonly cleanupTerminals: () => Promise<void>
  readonly disposeRuntime: () => Promise<void>
}) {
  let beforeQuitCleanupDone = false
  let beforeQuitCleanupInProgress = false
  app.on('before-quit', (e) => {
    input.disposeAutoUpdater()
    if (!beforeQuitCleanupDone) {
      e.preventDefault()
      if (beforeQuitCleanupInProgress) return
      beforeQuitCleanupInProgress = true
      let terminalsCleaned = false
      completeAppRuntimeShutdown({
        persistActiveRuns: input.persistActiveRuns,
        disposeRuntime: async () => {
          await input.cleanupTerminals()
          terminalsCleaned = true
          await input.disposeRuntime()
        },
      })
        .then(() => {
          beforeQuitCleanupDone = true
          app.quit()
        })
        .catch((error: unknown) => {
          logger.error('App shutdown did not complete', describeError(error))
          if (terminalsCleaned) {
            beforeQuitCleanupDone = true
            app.quit()
            return
          }
          beforeQuitCleanupInProgress = false
          try {
            showErrorBox(
              'OpenWaggle could not quit safely',
              'One or more terminal processes are still running. OpenWaggle stayed open so it can retry without orphaning them.',
            )
          } catch (dialogError) {
            logger.error('Could not show the terminal shutdown error', describeError(dialogError))
          }
        })
    }
  })
}
