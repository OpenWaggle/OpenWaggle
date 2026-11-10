import { configureApplicationMenu } from './application-menu'
import { isAutomationMode } from './desktop-automation-policy'
import { appLifecycle } from './desktop-shell/app-lifecycle'
import { desktopWindows } from './desktop-shell/desktop-windows'
import { systemIntegration } from './desktop-shell/system-integration'

/**
 * Before ready: the window policy, so automation fails closed before any service runs, and an
 * automated run stays out of the macOS Dock.
 */
export function prepareDesktopUi() {
  desktopWindows.installWindowPolicy()
  if (isAutomationMode() && process.platform === 'darwin') {
    systemIntegration.setActivationPolicy('accessory')
  }
}

// Packaged apps take their Dock icon from the bundle's Info.plist; setting the Dock icon at
// runtime makes macOS LaunchServices register a second Dock tile on every launch. Dev builds keep
// the runtime override so they stay visually distinct (ADR 0032).
export function configureDesktopUiAfterReady(devDockIconPath: string) {
  if (!isAutomationMode() && !appLifecycle.isPackaged() && process.platform === 'darwin') {
    systemIntegration.setDockIcon(devDockIconPath)
  }
  if (!isAutomationMode()) desktopWindows.installWindowShortcuts()
  configureApplicationMenu(appLifecycle.name(), !isAutomationMode())
}
