import { BUILD_CHANNEL, PRODUCT_NAME } from '@shared/build-identity-runtime'
import { app } from 'electron'
import type { BootShellShape } from '../../ports/desktop-shell/boot-shell'

/**
 * Electron's boot view of the shell; `electronAppPaths`, `electronAppLifecycle` and
 * `electronSystemIntegration` reuse these members. Electron derives `userData` from
 * `app.getName()`: released builds keep the canonical name (`openwaggle`, the package name), so
 * the existing install base is not orphaned; Dev builds are renamed to their own product name so a
 * stale local or worktree build can never read or overwrite the installed release's Sessions,
 * settings or credentials (ADR 0032).
 */
export const electronBootShell: BootShellShape = {
  applyBuildIdentity: () => {
    if (BUILD_CHANNEL === 'dev') app.setName(PRODUCT_NAME)
  },
  appRoot: () => app.getAppPath(),
  userData: () => app.getPath('userData'),
  version: () => app.getVersion(),
  isPackaged: () => app.isPackaged,
  exit: (code) => (code === undefined ? app.exit() : app.exit(code)),
  commandLine: {
    hasSwitch: (name) => app.commandLine.hasSwitch(name),
    getSwitchValue: (name) => app.commandLine.getSwitchValue(name),
    appendSwitch: (name, value) =>
      value === undefined
        ? app.commandLine.appendSwitch(name)
        : app.commandLine.appendSwitch(name, value),
  },
  setActivationPolicy: (policy) => app.setActivationPolicy(policy),
}
