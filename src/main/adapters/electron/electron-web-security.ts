import { session } from 'electron'
import type { WebSecurityShape } from '../../ports/desktop-shell/web-security'
import { watchChromiumCacheSize } from './electron-chromium-disk-cache'
import { installInlineVisualizationNavigationGuard } from './electron-embedded-frame-guard'
import { electronWebContentsOf } from './electron-window-policy'

export const electronWebSecurity: WebSecurityShape = {
  guardEmbeddedFrames: (surface) => {
    const contents = electronWebContentsOf(surface)
    if (contents) installInlineVisualizationNavigationGuard(contents)
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
