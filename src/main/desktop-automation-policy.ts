import { env } from './env'

/**
 * The non-disruptive automation policy (`OPENWAGGLE_AUTOMATION=1`): an automated run must never
 * show or focus a window, open a native dialog or menu, show a notification, or launch an
 * external application. Every desktop shell adapter enforces it and fails closed with this error.
 */
export class AutomationDesktopUiError extends Error {
  constructor(api: string) {
    super(`Blocked native desktop UI during non-disruptive automation: ${api}`)
    this.name = 'AutomationDesktopUiError'
  }
}

export function isAutomationMode() {
  return env.OPENWAGGLE_AUTOMATION === '1'
}

export function assertExternalApplicationLaunchAllowed() {
  if (isAutomationMode()) {
    throw new AutomationDesktopUiError('external-application.launch')
  }
}
