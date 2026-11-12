import { appLifecycle } from './desktop-shell/app-lifecycle'
import { systemIntegration } from './desktop-shell/system-integration'

/** This build as the receiver of `openwaggle:` links the operating system delivers (ADR 0056). */
export function sessionLinkHost() {
  return {
    isPackaged: appLifecycle.isPackaged(),
    onOpenUrl: systemIntegration.onOpenUrl,
    setAsDefaultProtocolClient: systemIntegration.setAsDefaultProtocolClient,
  }
}
