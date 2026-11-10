import { hasSessionLinkScheme } from '@shared/utils/session-link'
import { openExternal } from './desktop-ui'
import { describeError } from './error-description'
import { createLogger } from './logger'
import { requestOpenSessionLink } from './session-link-requests'

const logger = createLogger('main/external-navigation')

export function externalNavigationProtocol(url: string) {
  try {
    return new URL(url).protocol
  } catch {
    return 'invalid'
  }
}

/**
 * Open a link the renderer navigated to or opened in a new window. A Session link opens its
 * Session in this app and is never handed to the operating system, which could route it to a
 * different build (ADR 0056); any other `openwaggle:` URL is refused the same way.
 */
export function openExternalFromRenderer(url: string) {
  if (hasSessionLinkScheme(url)) {
    requestOpenSessionLink(url)
    return
  }
  void openExternal(url).catch((error: unknown) => {
    logger.warn('External navigation was not opened', {
      error: describeError(error),
      protocol: externalNavigationProtocol(url),
    })
  })
}
