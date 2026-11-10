/**
 * Under non-disruptive automation (`OPENWAGGLE_AUTOMATION=1`) every OS-visible shell call fails
 * closed with this error name, before anything reaches the screen.
 */
export const AUTOMATION_BLOCKED = { name: 'AutomationDesktopUiError' }
