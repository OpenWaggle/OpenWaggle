import { env } from './env'

const RENDERER_PROTOCOL = 'openwaggle'
const RENDERER_PROTOCOL_HOST = 'app'

export function isTrustedRendererRequest(url: string) {
  if (url.startsWith('file://')) return true

  try {
    const parsedUrl = new URL(url)
    if (
      parsedUrl.protocol === `${RENDERER_PROTOCOL}:` &&
      parsedUrl.host === RENDERER_PROTOCOL_HOST
    ) {
      return true
    }
    if (!env.ELECTRON_RENDERER_URL) return false
    return parsedUrl.origin === new URL(env.ELECTRON_RENDERER_URL).origin
  } catch {
    return false
  }
}
