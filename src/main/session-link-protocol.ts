import { BUILD_CHANNEL } from '@shared/build-identity-runtime'
import type { BuildChannel } from '@shared/types/build-identity'
import { channelClaimsSessionLinks, SESSION_LINK_SCHEME } from '@shared/utils/session-link'
import { createLogger } from './logger'

const logger = createLogger('session-link-protocol')

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
 * (ADR 0056); see `channelClaimsSessionLinks`. Automated runs never change the system's handlers.
 */
export function claimsSessionLinksFromOperatingSystem(input: {
  readonly isPackaged: boolean
  readonly channel: BuildChannel
  readonly automation: boolean
}) {
  return input.isPackaged && channelClaimsSessionLinks(input.channel) && !input.automation
}

/**
 * Receive Session links the operating system opens. macOS delivers them to the running app as
 * `open-url`, including the link that launched it, so the listener is installed before the app
 * is ready. Windows and Linux start the executable with the link instead (see
 * `top-level-cli-session-link`). The macOS bundle declares the scheme in its Info.plist and the
 * Linux installer's desktop entry declares it (`scripts/install.sh`); Windows registers it at
 * runtime, and only for a build that claims links.
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
  if (
    claimsLinks &&
    platform === 'win32' &&
    !input.host.setAsDefaultProtocolClient(SESSION_LINK_SCHEME)
  ) {
    logger.warn('Windows did not register OpenWaggle for Session links', {
      scheme: SESSION_LINK_SCHEME,
    })
  }
}
