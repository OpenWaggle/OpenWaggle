import { BUILD_CHANNEL } from '@shared/build-identity-runtime'
import type { BuildChannel } from '@shared/types/build-identity'
import { SESSION_LINK_SCHEME } from '@shared/utils/session-link'

export interface SessionLinkProtocolHost {
  readonly isPackaged: boolean
  readonly on: (
    event: 'open-url',
    listener: (event: { readonly preventDefault: () => void }, url: string) => void,
  ) => void
  readonly setAsDefaultProtocolClient: (protocol: string) => boolean
}

/**
 * Only an installed release build claims `openwaggle:` links from the operating system
 * (ADR 0056). Release channels share one identity and Session data (ADR 0032); a dev build keeps
 * its own data, so letting it claim the scheme would open links in a build that lacks their
 * Session. Automated runs never change the system's handlers.
 */
export function claimsSessionLinksFromOperatingSystem(input: {
  readonly isPackaged: boolean
  readonly channel: BuildChannel
  readonly automation: boolean
}) {
  return input.isPackaged && input.channel !== 'dev' && !input.automation
}

/**
 * Receive Session links the operating system opens. macOS delivers them to the running app as
 * `open-url`, including the link that launched it, so the listener is installed before the app
 * is ready. Windows and Linux start the executable with the link instead (see
 * `top-level-cli-session-link`). macOS and Linux declare the scheme in the packaged bundle;
 * Windows registers it at runtime, and only for a build that claims links.
 */
export function installSessionLinkProtocol(input: {
  readonly host: SessionLinkProtocolHost
  readonly automation: boolean
  readonly openLink: (url: string) => void
  readonly platform?: NodeJS.Platform
  readonly channel?: BuildChannel
}) {
  const platform = input.platform ?? process.platform
  if (platform === 'darwin') {
    input.host.on('open-url', (event, url) => {
      event.preventDefault()
      input.openLink(url)
    })
  }
  const claimsLinks = claimsSessionLinksFromOperatingSystem({
    isPackaged: input.host.isPackaged,
    channel: input.channel ?? BUILD_CHANNEL,
    automation: input.automation,
  })
  if (claimsLinks && platform === 'win32') {
    input.host.setAsDefaultProtocolClient(SESSION_LINK_SCHEME)
  }
}
