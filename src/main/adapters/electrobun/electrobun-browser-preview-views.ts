import path from 'node:path'
import {
  BROWSER_PREVIEW_NAVIGATION_RULES,
  type ElectrobunPreviewHost,
} from './browser-preview/electrobun-preview-record-factory'
import { openWebSocket } from './browser-preview/cdp-connection'
import {
  takeCefRemoteDebuggingPortVariable,
  CefDevToolsEndpoint,
  resolveCefRemoteDebuggingPort,
} from './browser-preview/cef-devtools-endpoint'
import { electrobunOwnerWindow } from './browser-preview/electrobun-owner-windows'
import { makeElectrobunBrowserPreview } from './browser-preview/electrobun-browser-preview-shape'
import { electrobunNativeWebviewFrames } from './browser-preview/electrobun-webview-frames'
import { electrobun } from './electrobun-sdk'
import { openBackgroundWindow } from './electrobun-window-policy'
import type { PrepareBrowserPreviewAnnotation } from '../browser-preview/annotation/browser-preview-annotation'
import { BrowserPreviewArtifactStorage } from '../browser-preview/browser-preview-artifact-storage'
import type { AppPathsShape } from '../../ports/desktop-shell/app-paths'
import type { BrowserEngineShape } from '../../ports/desktop-shell/browser-engine'
import type { BrowserPreviewViewsShape } from '../../ports/desktop-shell/browser-preview-views'
import type { ClipboardShape } from '../../ports/desktop-shell/clipboard'
import type { OsShellShape } from '../../ports/desktop-shell/os-shell'

const ARTIFACT_DIRECTORY_NAME = 'browser-preview-artifacts'
const INITIAL_FRAME = { x: 0, y: 0, width: 1, height: 1 } as const

function cefDevToolsEndpoint(environmentPort: string | undefined) {
  const port = resolveCefRemoteDebuggingPort({
    environmentPort,
    chromiumFlags: electrobun().BuildConfig.getSync().chromiumFlags,
  })
  return (
    port === null ? null : new CefDevToolsEndpoint(port, (url) => fetch(url))
  ) satisfies CefDevToolsEndpoint | null
}

/** The other desktop shell ports the Browser preview reaches. */
export interface ElectrobunBrowserPreviewShell {
  readonly appPaths: Pick<AppPathsShape, 'userData'>
  readonly engine: Pick<BrowserEngineShape, 'ensure' | 'status'>
  readonly clipboard: Pick<ClipboardShape, 'writeImage'>
  readonly osShell: Pick<OsShellShape, 'showItemInFolder'>
  /** How an annotation becomes a composer attachment; the Session Host's when absent. */
  readonly prepareAnnotation?: PrepareBrowserPreviewAnnotation
}

/** The shell side of the Electrobun Browser preview, from the loaded SDK and the shell ports. */
export function electrobunPreviewHost(shell: ElectrobunBrowserPreviewShell) {
  // Taken before the app starts any child process; see cef-devtools-endpoint.ts.
  const environmentPort = takeCefRemoteDebuggingPortVariable()
  let maintenanceWindowId: number | null = null
  let artifacts: BrowserPreviewArtifactStorage | null = null
  let endpoint: CefDevToolsEndpoint | null | undefined
  return {
    engine: shell.engine,
    createView: ({ windowId, url, partition }) =>
      new (electrobun().BrowserView)({
        windowId,
        url,
        partition,
        renderer: 'cef',
        sandbox: true,
        autoResize: false,
        frame: INITIAL_FRAME,
        navigationRules: JSON.stringify(BROWSER_PREVIEW_NAVIGATION_RULES),
      }),
    frames: electrobunNativeWebviewFrames(),
    endpoint: () => {
      endpoint ??= cefDevToolsEndpoint(environmentPort)
      return endpoint
    },
    openSocket: openWebSocket,
    ownerWindowOf: (owner) => {
      const sdk = electrobun()
      return electrobunOwnerWindow(
        {
          BrowserView: sdk.BrowserView,
          BrowserWindow: sdk.BrowserWindow,
          events: sdk.events,
        },
        owner.id,
      )
    },
    maintenanceWindowId: () => {
      maintenanceWindowId ??= openBackgroundWindow({
        title: 'OpenWaggle browser profiles',
        html: '<!doctype html><title></title>',
      })
      return maintenanceWindowId
    },
    artifacts: () => {
      artifacts ??= new BrowserPreviewArtifactStorage(
        path.join(shell.appPaths.userData(), ARTIFACT_DIRECTORY_NAME),
      )
      return artifacts
    },
    revealInFolder: (artifactPath) => shell.osShell.showItemInFolder(artifactPath),
    ...(shell.prepareAnnotation ? { prepareAnnotation: shell.prepareAnnotation } : {}),
    writeClipboardImage: async (png) => {
      if ((await shell.clipboard.writeImage(png)) === 'undecodable') {
        throw new Error('Browser preview screenshot could not be decoded.')
      }
    },
    isMac: process.platform === 'darwin',
    // Windows ships no CEF: its previews are WebView2 profiles (scripts/electrobun/app-config.ts).
    unloadsPartitionWithLastView: process.platform === 'win32',
  } satisfies ElectrobunPreviewHost
}

/**
 * The Browser preview on Electrobun (ADR 0064): CEF `BrowserView`s in the owner page's window
 * (on Windows, WebView2 views of its Chromium environment, vendor/electrobun patch 0013), driven
 * over the DevTools endpoint, and the same previews as the agent's automation sees them.
 * Creating it reaches no native code; the views load the SDK on first use.
 */
export function createElectrobunBrowserPreview(shell: ElectrobunBrowserPreviewShell) {
  return makeElectrobunBrowserPreview(electrobunPreviewHost(shell))
}

export function createElectrobunBrowserPreviewViews(shell: ElectrobunBrowserPreviewShell) {
  return createElectrobunBrowserPreview(shell).views
}
