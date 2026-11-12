import { appLifecycle } from './desktop-shell/app-lifecycle'
import { systemIntegration } from './desktop-shell/system-integration'
import type { SessionLinkProtocolHost } from './session-link-protocol'

/** This build as the receiver of `openwaggle:` links the operating system delivers (ADR 0056). */
export function sessionLinkHost(): SessionLinkProtocolHost {
  return {
    isPackaged: appLifecycle.isPackaged(),
    onOpenUrl: systemIntegration.onOpenUrl,
    setAsDefaultProtocolClient: systemIntegration.setAsDefaultProtocolClient,
  }
}
