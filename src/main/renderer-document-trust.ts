import { env } from './env'

const RENDERER_PROTOCOL = 'openwaggle:'
const RENDERER_HOST = 'app'

/**
 * True only for a top-level document served by OpenWaggle itself. Browser-preview
 * ownership may survive these trusted reloads because the Electron WebContents is
 * unchanged; any other cross-document navigation revokes the capability.
 */
export function isTrustedRendererDocument(url: string): boolean {
  try {
    const candidate = new URL(url)
    if (candidate.protocol === RENDERER_PROTOCOL && candidate.host === RENDERER_HOST) {
      return true
    }
    if (!env.ELECTRON_RENDERER_URL) return false
    return candidate.origin === new URL(env.ELECTRON_RENDERER_URL).origin
  } catch {
    return false
  }
}
