import { openExternal } from './desktop-ui'
import { describeError } from './error-description'
import { createLogger } from './logger'

const logger = createLogger('main/external-navigation')

export function externalNavigationProtocol(url: string) {
  try {
    return new URL(url).protocol
  } catch {
    return 'invalid'
  }
}

export function openExternalFromRenderer(url: string) {
  void openExternal(url).catch((error: unknown) => {
    logger.warn('External navigation was not opened', {
      error: describeError(error),
      protocol: externalNavigationProtocol(url),
    })
  })
}
