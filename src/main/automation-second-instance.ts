import { writeFile } from 'node:fs/promises'
import { appLifecycle } from './desktop-shell/app-lifecycle'
import { describeError } from './error-description'
import { createLogger } from './logger'

const FAILURE_EXIT_CODE = 1
const AUTOMATION_SECOND_INSTANCE_EXIT_GRACE_MS = 5_000
const AUTOMATION_SINGLE_INSTANCE_LOCK_DENIED_MARKER_SWITCH =
  'openwaggle-automation-single-instance-lock-denied-marker'
const AUTOMATION_SINGLE_INSTANCE_LOCK_DENIED_MARKER_CONTENT = 'single-instance-lock-denied\n'

const logger = createLogger('main/index')

/**
 * An automation launch that lost the single-instance lock: it proves so by writing the marker
 * file its probe named, then quits after a grace period the probe reads it in.
 */
export function quitAutomationSecondInstance() {
  const markerPath = appLifecycle.commandLine.getSwitchValue(
    AUTOMATION_SINGLE_INSTANCE_LOCK_DENIED_MARKER_SWITCH,
  )
  if (!markerPath) {
    logger.error('Automation second-instance probe omitted its lock-denied marker path')
    appLifecycle.exit(FAILURE_EXIT_CODE)
    return
  }
  void writeFile(markerPath, AUTOMATION_SINGLE_INSTANCE_LOCK_DENIED_MARKER_CONTENT, {
    flag: 'wx',
  }).then(
    () => setTimeout(() => appLifecycle.quit(), AUTOMATION_SECOND_INSTANCE_EXIT_GRACE_MS),
    (error: unknown) => {
      logger.error('Automation second-instance lock-denied marker failed', describeError(error))
      appLifecycle.exit(FAILURE_EXIT_CODE)
    },
  )
}
