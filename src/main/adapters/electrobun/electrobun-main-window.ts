import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { homeDirectoryRendererArguments } from '@shared/home-directory-argument'
import { isAutomationMode } from '../../desktop-automation-policy'
import { appPaths } from '../../desktop-shell/app-paths'
import { electronMigrationRendererArguments } from '../../electron-migration/first-launch'
import { errorReportingRendererArguments } from '../../error-reporting'
import type { MainWindowRequest } from '../../ports/desktop-shell/desktop-windows'
import {
  devRendererUrl,
  INDEX_HTML,
  RENDERER_PROTOCOL_HOST,
  rendererUrlWithAutomationIdentity,
} from '../../renderer-protocol'
import { electrobun } from './electrobun-sdk'
import { electrobunTrustedOrigins } from './electrobun-trusted-origins'
import { rendererDocumentHeaders } from './electrobun-web-security'
import { openAppWindow, revealWindow } from './electrobun-window-policy'
import { windowShortcutsInstalled } from './electrobun-window-shortcuts'

/**
 * The app's main window on Electrobun (ADR 0064): the renderer page from its loopback origin (or
 * the Vite dev server), the Electrobun preload injected before the page's scripts, and the
 * renderer's Content Security Policy on every document of its origin. It is created hidden and
 * shown once its page's DOM is ready, the nearest Electrobun has to Electron's `ready-to-show`;
 * never under automation.
 *
 * The main frame may only load the renderer's own documents (`navigationRules`, last match wins);
 * any other navigation, and any link the page opens in a new window, goes to `openLink`.
 *
 * Not carried over from Electron: the fullscreen events (`window:fullscreen-changed`; Electrobun
 * reports none, so the renderer keeps its non-fullscreen layout), media permission handlers (the
 * system webview asks the user per origin, and only the renderer's origin uses media), and the
 * renderer error-report bridge (`electrobun-error-reporting-bridge.ts`).
 */
const WIDTH = 1200
const HEIGHT = 800
const TRAFFIC_LIGHT_X = 16
const TRAFFIC_LIGHT_Y = 16
/** The preload bundle `scripts/build-electrobun-preload.ts` writes. */
const PRELOAD_BUNDLE = join('out', 'preload', 'electrobun.js')
/** Set first in the injected preload; `electrobun-transport.ts` reads and deletes it. */
const RENDERER_ARGUMENTS_GLOBAL = '__openwaggleRendererArguments'

/** The injected preload: the renderer arguments, then the bundle. */
function preloadScript() {
  const bundle = readFileSync(join(appPaths.appRoot(), PRELOAD_BUNDLE), 'utf8')
  const args = JSON.stringify([
    ...errorReportingRendererArguments(),
    ...homeDirectoryRendererArguments(homedir()),
    ...electronMigrationRendererArguments(),
  ])
  return `globalThis.${RENDERER_ARGUMENTS_GLOBAL} = ${args};\n${bundle}`
}

function rendererUrl() {
  const devUrl = devRendererUrl()
  if (devUrl !== null) return devUrl
  return `${electrobunTrustedOrigins.originOf('renderer', RENDERER_PROTOCOL_HOST)}/${INDEX_HTML}`
}

/** Block every main-frame navigation, then allow the renderer's own documents. */
export function rendererNavigationRules(url: string) {
  const parsed = new URL(url)
  const documents = `${parsed.origin}${parsed.pathname.slice(0, parsed.pathname.lastIndexOf('/'))}/*`
  return JSON.stringify(['^*', documents])
}

/** The renderer's form of a URL: its scheme form for a trusted origin's page, others as is. */
function logicalUrl(url: string) {
  return electrobunTrustedOrigins.locate(url)?.logicalUrl ?? url
}

export function createMainWindow(request: MainWindowRequest) {
  electrobunTrustedOrigins.setDocumentHeaders('renderer', () => rendererDocumentHeaders())
  const url = rendererUrl()
  const packaged = electrobun().BuildConfig.getSync().isPackaged
  request.startupMark('renderer-load-start')
  const window = openAppWindow(
    {
      title: 'OpenWaggle',
      frame: { width: WIDTH, height: HEIGHT },
      url: rendererUrlWithAutomationIdentity(url),
      preload: preloadScript(),
      titleBarStyle: 'hiddenInset',
      trafficLightOffset: { x: TRAFFIC_LIGHT_X, y: TRAFFIC_LIGHT_Y },
      navigationRules: rendererNavigationRules(url),
      // Electrobun's sandbox turns the page's RPC off; the page is the app's own.
      sandbox: false,
      hidden: true,
    },
    {
      openLink: request.openLink,
      devTools: !packaged && windowShortcutsInstalled() && !isAutomationMode(),
      logicalUrl,
    },
  )
  let ready = false
  window.window.webview.on('dom-ready', () => {
    // Every load reports it; only the first one reveals the window.
    if (ready) return
    ready = true
    request.startupMark('renderer-dom-ready')
    request.startupMark('window-ready-to-show')
    if (isAutomationMode() || window.isDestroyed()) return
    revealWindow(window.window)
    request.startupMark('window-shown')
  })
  return window
}
