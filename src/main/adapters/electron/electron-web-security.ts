import { session } from 'electron'
import type { WebSecurityShape } from '../../ports/desktop-shell/web-security'
import { watchChromiumCacheSize } from './electron-chromium-disk-cache'
import { installInlineVisualizationNavigationGuard } from './electron-embedded-frame-guard'
import { electronWebContentsOf } from './electron-window-policy'

export const electronWebSecurity: WebSecurityShape = {
  guardEmbeddedFrames: (surface) => {
    const contents = electronWebContentsOf(surface)
    // Fail closed: a page this guard cannot find would keep its frames unconfined.
    if (!contents) {
      throw new Error(
        `Cannot confine the frames of renderer surface ${String(surface.id)}: Electron has no page with that id.`,
      )
    }
    installInlineVisualizationNavigationGuard(contents)
  },
  originStorageOf: (surface) => {
    const profile = electronWebContentsOf(surface)?.session
    return {
      clear: (origins) => {
        if (!profile) return
        for (const origin of origins) {
          void profile.clearStorageData({ origin }).catch(() => undefined)
        }
      },
    }
  },
  maintainCaches: () => watchChromiumCacheSize(session.defaultSession),
}
