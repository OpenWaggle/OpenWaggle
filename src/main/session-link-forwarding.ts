import { isAutomationMode, launchExternalApplication } from './desktop-ui'
import { describeError } from './error-description'
import { createLogger } from './logger'
import {
  forwardSessionLinksToDesktopApp,
  type SessionLinkProtocolHost,
} from './session-link-protocol'

const logger = createLogger('session-link-forwarding')

/**
 * In the Session Host and `openwaggle` commands, hand a Session link macOS delivered to this
 * process to the desktop app (ADR 0056). The executable is started directly rather than through
 * LaunchServices, which could deliver the link back here.
 */
export function forwardSessionLinksFromBackgroundProcess(
  host: Pick<SessionLinkProtocolHost, 'isPackaged' | 'on'>,
) {
  forwardSessionLinksToDesktopApp({
    host,
    automation: isAutomationMode(),
    launchDesktopApp: (link) => {
      void launchExternalApplication(process.execPath, ['--', link]).catch((error: unknown) => {
        logger.warn('Could not hand a Session link to the desktop app', describeError(error))
      })
    },
  })
}
