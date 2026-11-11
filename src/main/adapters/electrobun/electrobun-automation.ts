import { AutomationDesktopUiError, isAutomationMode } from '../../desktop-automation-policy'

/**
 * Non-disruptive automation (`OPENWAGGLE_AUTOMATION=1`) fails every OS-visible shell call closed
 * before it reaches the screen. Electron's adapters get this from blockers installed over
 * Electron's modules; Electrobun's ask here, at the top of each OS-visible member.
 */
export function assertDesktopUiAllowed(api: string) {
  if (isAutomationMode()) throw new AutomationDesktopUiError(api)
}

/** The async form: rejects instead of throwing. */
export async function desktopUiAllowed(api: string) {
  assertDesktopUiAllowed(api)
}
