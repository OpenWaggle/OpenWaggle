import { isBrowserPreviewUrl, normalizeBrowserPreviewUrl } from '@shared/schemas/browser-preview'
import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Event,
  HandlerDetails,
  Input,
  WebContents,
  WindowOpenHandlerResponse,
} from 'electron'
import { installBrowserPreviewContextMenu } from './browser-preview-context-menu'
import { synchronizeBrowserPreviewEditingShortcuts } from './browser-preview-editing-shortcuts'
import { isAutomationMode } from './desktop-ui'
import { SECURE_WEB_PREFERENCES } from './security/electron-security'

const MAX_POPUPS_PER_PREVIEW = 2

export const BROWSER_PREVIEW_POPUP_OPTIONS = {
  autoHideMenuBar: true,
  webPreferences: {
    ...SECURE_WEB_PREFERENCES,
    webviewTag: false,
    enableWebSQL: false,
    navigateOnDragDrop: false,
    disableDialogs: true,
    disableHtmlFullscreenWindowResize: true,
    devTools: false,
    plugins: false,
    autoplayPolicy: 'user-gesture-required',
  },
} satisfies BrowserWindowConstructorOptions

export function browserPreviewWindowOpenAction(
  details: Pick<HandlerDetails, 'disposition' | 'url'>,
  automation = isAutomationMode(),
) {
  if (automation || !isBrowserPreviewUrl(details.url)) return 'block'
  return details.disposition === 'new-window' ? 'popup' : 'navigate'
}

interface BrowserPreviewPopupPolicyOptions {
  readonly navigate: (url: string) => void
  readonly onBlocked: (url: string) => void
}

export interface BrowserPreviewPopupPolicy {
  readonly dispose: () => void
  readonly popupCount: () => number
}

export function installBrowserPreviewPopupPolicy(
  contents: WebContents,
  options: BrowserPreviewPopupPolicyOptions,
): BrowserPreviewPopupPolicy {
  const popups = new Set<BrowserWindow>()
  let pendingPopups = 0

  const windowOpen = (details: HandlerDetails): WindowOpenHandlerResponse => {
    const action = browserPreviewWindowOpenAction(details)
    if (action === 'navigate') {
      options.navigate(normalizeBrowserPreviewUrl(details.url))
      return { action: 'deny' }
    }
    if (action !== 'popup' || popups.size + pendingPopups >= MAX_POPUPS_PER_PREVIEW) {
      options.onBlocked(details.url)
      return { action: 'deny' }
    }
    pendingPopups += 1
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        ...BROWSER_PREVIEW_POPUP_OPTIONS,
        webPreferences: {
          ...BROWSER_PREVIEW_POPUP_OPTIONS.webPreferences,
          session: contents.session,
        },
      },
    }
  }

  const windowCreated = (popup: BrowserWindow) => {
    if (popups.has(popup)) return
    pendingPopups = Math.max(0, pendingPopups - 1)
    popups.add(popup)
    const removeContextMenu = installBrowserPreviewContextMenu(popup.webContents, popup)
    popup.webContents.setIgnoreMenuShortcuts(true)
    popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const onInput = (_event: Event, input: Input) =>
      synchronizeBrowserPreviewEditingShortcuts(popup.webContents, input)
    popup.webContents.on('before-input-event', onInput)
    const preventUnsafeNavigation = (event: Event, url: string) => {
      if (!isBrowserPreviewUrl(url)) event.preventDefault()
    }
    popup.webContents.on('will-navigate', preventUnsafeNavigation)
    popup.webContents.on('will-redirect', preventUnsafeNavigation)
    popup.once('closed', () => {
      removeContextMenu()
      popups.delete(popup)
      if (!popup.webContents.isDestroyed()) {
        popup.webContents.removeListener('before-input-event', onInput)
        popup.webContents.removeListener('will-navigate', preventUnsafeNavigation)
        popup.webContents.removeListener('will-redirect', preventUnsafeNavigation)
      }
    })
  }

  contents.setWindowOpenHandler(windowOpen)
  contents.on('did-create-window', windowCreated)

  return {
    dispose: () => {
      contents.removeListener('did-create-window', windowCreated)
      contents.setWindowOpenHandler(() => ({ action: 'deny' }))
      for (const popup of popups) {
        if (!popup.isDestroyed()) popup.close()
      }
      popups.clear()
      pendingPopups = 0
    },
    popupCount: () => popups.size + pendingPopups,
  }
}
