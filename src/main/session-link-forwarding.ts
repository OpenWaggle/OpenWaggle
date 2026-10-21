import path from 'node:path'
import type { BuildChannel } from '@shared/types/build-identity'
import { isAutomationMode, launchExternalApplication } from './desktop-ui'
import { describeError } from './error-description'
import { createLogger } from './logger'
import {
  forwardSessionLinksToDesktopApp,
  type SessionLinkProtocolHost,
} from './session-link-protocol'

const logger = createLogger('session-link-forwarding')

/** `<bundle>.app/Contents/MacOS/<executable>` → `<bundle>.app`. */
const BUNDLE_FROM_EXECUTABLE = ['..', '..', '..'] as const

/**
 * `open` arguments that start a new desktop app instance with the link as a launch argument. A
 * new instance (`-n`) is needed because the running instance LaunchServices would pick may be
 * this very process. Passed as arguments rather than a URL, the link is not delivered as
 * `open-url` again, and the app gets the environment of a normal launch, not this process's.
 */
export function desktopAppLaunchArguments(executablePath: string, link: string) {
  const bundle = path.resolve(executablePath, ...BUNDLE_FROM_EXECUTABLE)
  return ['-n', '-a', bundle, '--args', '--', link]
}

/**
 * In the Session Host and `openwaggle` commands, hand a Session link macOS delivered to this
 * process to the desktop app (ADR 0056). The new instance opens the Session, or forwards it to
 * the running app through the single-instance lock and quits.
 */
export function forwardSessionLinksFromBackgroundProcess(
  host: Pick<SessionLinkProtocolHost, 'isPackaged' | 'on'>,
  build: { readonly platform?: NodeJS.Platform; readonly channel?: BuildChannel } = {},
) {
  forwardSessionLinksToDesktopApp({
    ...build,
    host,
    automation: isAutomationMode(),
    launchDesktopApp: (link) => {
      const args = desktopAppLaunchArguments(process.execPath, link)
      void launchExternalApplication('open', args).catch((error: unknown) => {
        logger.warn('Could not hand a Session link to the desktop app', describeError(error))
      })
    },
  })
}
