import { EventEmitter } from 'node:events'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import { structuredTransport } from '@shared/structured-wire'
import {
  type DesktopShellRpc,
  SHELL_EVENT_MESSAGE,
  SHELL_FIRST_FRAME_MESSAGE,
  SHELL_FOCUS_MESSAGE,
  SHELL_HEARTBEAT_REQUEST,
  SHELL_INVOKE_REQUEST,
  SHELL_SEND_MESSAGE,
  SHELL_TOGGLE_DEVTOOLS_MESSAGE,
} from '@shared/types/desktop-shell-rpc'
import type { BrowserView } from 'electrobun/main'
import type {
  RendererSurface,
  RendererSurfaceNavigationStart,
  RendererSurfacesShape,
} from '../../ports/desktop-shell/renderer-surfaces'
import { answerInvoke, deliverSend } from './electrobun-ipc-main-transport'
import { electrobun } from './electrobun-sdk'
import { uncheckedFields } from '@shared/utils/object-shape'

/**
 * Electrobun's renderer surfaces (ADR 0064): each app webview the shell opens with the app's RPC
 * (`DesktopShellRpc`) is a surface whose id is the Electrobun webview id, so another adapter can
 * find its window (`BrowserView.windowId`) and attach views to it. `send` is a `shell:event`
 * message, and the page's invokes and sends reach the IPC transport with the surface as sender.
 *
 * Electrobun reports `will-navigate` (with whether the navigation rules allowed it),
 * `did-commit-navigation` and `did-navigate-in-page`, which become the port's navigation events. It has no event for a
 * crashed web process, so the surface sends a `shell:heartbeat` request every few seconds. Once the
 * page has answered one, a page that then answers none for `PAGE_GONE_AFTER_MS` is reported as
 * `render-process-gone` and its document is loaded again. The window is long because a busy or
 * hidden page answers late, not never: on a loaded CI Mac, three missed 5 s beats reloaded a page
 * that was working. A page still on its first load is never reported.
 *
 * CEF creates every browser on `about:blank` and reports that load like any other before it loads
 * the app's document, so `about:blank` is not one of the page's documents: it neither counts as a
 * navigation nor becomes the document a reload returns to.
 *
 * URLs the surface reports (`getURL`, navigation events) are in the form the rest of the app
 * knows: a page of a trusted origin reads as its scheme form (`openwaggle://app/index.html`), not
 * as the loopback address the webview loaded (`AppWebviewOptions.logicalUrl`).
 */
export const HEARTBEAT_INTERVAL_MS = 5_000
export const HEARTBEAT_TIMEOUT_MS = 5_000
export const PAGE_GONE_AFTER_MS = 60_000
const INITIAL_BROWSER_URL = 'about:blank'

interface SurfaceEvents {
  destroyed: []
  'did-navigate': []
  'render-process-gone': []
  'did-start-navigation': [RendererSurfaceNavigationStart]
  /** The page can be shown: its document is parsed and styled (`src/preload/first-frame.ts`). */
  'first-frame': []
}

type ShellRpc = ReturnType<typeof createShellRpc>

const willNavigateDetail = Schema.parseJson(
  Schema.Struct({ url: Schema.String, allowed: Schema.Boolean }),
)
const newWindowDetail = Schema.Struct({ url: Schema.String })

/** The `detail` of an Electrobun webview event (`{ data: { detail } }`). */
function eventDetail(event: unknown) {
  const { data } = uncheckedFields<{ data: unknown }>(event)
  return uncheckedFields<{ detail: unknown }>(data).detail
}

export class ElectrobunRendererSurface
  extends EventEmitter<SurfaceEvents>
  implements RendererSurface
{
  readonly id: number
  private url: string
  private destroyed = false
  /** When the page last answered a heartbeat; `null` until it first does. */
  private answeredAt: number | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private awaitingBeat = false

  private readonly view: BrowserView
  private readonly rpc: ShellRpc
  private readonly options: AppWebviewOptions

  constructor(view: BrowserView, rpc: ShellRpc, options: AppWebviewOptions) {
    super()
    this.view = view
    this.rpc = rpc
    this.options = options
    this.id = view.id
    this.url = view.url ?? ''
  }

  isDestroyed() {
    return this.destroyed
  }

  getURL() {
    return this.options.logicalUrl(this.url)
  }

  send(channel: string, ...args: unknown[]) {
    if (this.destroyed) return
    void this.rpc.send(SHELL_EVENT_MESSAGE, { channel, args })
  }

  /** Moves keyboard focus into the page, as Electron's `webContents.focus()` does. */
  focus() {
    if (!this.destroyed) void this.rpc.send(SHELL_FOCUS_MESSAGE)
  }

  /** The page's DevTools shortcut; only unpackaged builds have DevTools. */
  toggleDevTools() {
    if (this.options.devTools && !this.destroyed) this.view.toggleDevTools()
  }

  /** Records a navigation Electrobun reported; a blocked one never starts. */
  navigated(kind: 'start' | 'commit' | 'in-page', url: string) {
    if (url === INITIAL_BROWSER_URL) return
    const logical = this.options.logicalUrl(url)
    if (kind === 'start') {
      this.emit('did-start-navigation', { url: logical, isMainFrame: true, isSameDocument: false })
      return
    }
    this.url = url
    if (kind === 'commit') {
      this.emit('did-navigate')
      return
    }
    this.emit('did-start-navigation', { url: logical, isMainFrame: true, isSameDocument: true })
  }

  startHeartbeat() {
    if (this.heartbeat || this.destroyed) return
    this.heartbeat = setInterval(() => void this.beat(), HEARTBEAT_INTERVAL_MS)
    // The heartbeat watches a page; it never keeps the process alive on its own.
    this.heartbeat.unref()
  }

  private async beat() {
    if (this.awaitingBeat) return
    this.awaitingBeat = true
    try {
      await this.rpc.request(SHELL_HEARTBEAT_REQUEST, undefined, {
        maxRequestTime: HEARTBEAT_TIMEOUT_MS,
      })
      this.answeredAt = Date.now()
    } catch {
      const silentFor = this.answeredAt === null ? 0 : Date.now() - this.answeredAt
      if (silentFor >= PAGE_GONE_AFTER_MS && !this.destroyed) this.renderProcessGone()
    } finally {
      this.awaitingBeat = false
    }
  }

  /** The page stopped answering: its document is gone, so the page loads it again. */
  private renderProcessGone() {
    // The reloaded page is on its first load again until it answers.
    this.answeredAt = null
    this.emit('render-process-gone')
    if (this.url) this.view.loadURL(this.url)
  }

  /** The webview closed for good; the surface emits nothing after this. */
  markDestroyed() {
    if (this.destroyed) return
    this.destroyed = true
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    surfaces.delete(this.id)
    this.emit('destroyed')
    this.removeAllListeners()
  }
}

const surfaces = new Map<number, ElectrobunRendererSurface>()

function createShellRpc(sender: () => ElectrobunRendererSurface | null) {
  const pageGone = () => new Error('The page closed before its request was answered.')
  return electrobun().BrowserView.defineRPC<DesktopShellRpc>({
    maxRequestTime: HEARTBEAT_TIMEOUT_MS,
    handlers: {
      requests: {
        [SHELL_INVOKE_REQUEST]: async ({ channel, args }) => {
          const surface = sender()
          if (!surface) throw pageGone()
          return answerInvoke(surface, channel, args)
        },
      },
      messages: {
        [SHELL_SEND_MESSAGE]: ({ channel, args }) => {
          const surface = sender()
          if (surface) deliverSend(surface, channel, args)
        },
        [SHELL_TOGGLE_DEVTOOLS_MESSAGE]: () => sender()?.toggleDevTools(),
        [SHELL_FIRST_FRAME_MESSAGE]: () => sender()?.emit('first-frame'),
      },
    },
  })
}

export interface AppWebviewOptions {
  /** Where a link the page opens in a new window, or navigates to off its documents, goes. */
  readonly openLink: (url: string) => void
  /** Whether the page's DevTools shortcut opens DevTools (unpackaged builds). */
  readonly devTools: boolean
  /** The form the app knows `url` by: a trusted origin's page in scheme form, others as is. */
  readonly logicalUrl: (url: string) => string
}

export interface AppWebviewLink {
  /** The RPC the webview is created with (`BrowserWindow`'s `rpc` option). */
  readonly rpc: ShellRpc
  /** Makes the created webview a renderer surface; call once, right after creating it. */
  readonly attach: (view: BrowserView, options: AppWebviewOptions) => ElectrobunRendererSurface
}

/**
 * The RPC for a new app webview, and how its webview becomes a surface: create the window with
 * `link.rpc`, then `link.attach(window.webview, ...)`.
 */
export function createAppWebviewLink() {
  let surface: ElectrobunRendererSurface | null = null
  const rpc = createShellRpc(() => surface)
  return {
    rpc,
    attach: (view, options) => {
      // Electrobun's transport carries JSON; this one carries structured values over it.
      rpc.setTransport(structuredTransport(view.createTransport()))
      const attached = new ElectrobunRendererSurface(view, rpc, options)
      surface = attached
      surfaces.set(attached.id, attached)
      watchWebview(view, attached, options.openLink)
      attached.startHeartbeat()
      return attached
    },
  } satisfies AppWebviewLink
}

function watchWebview(
  view: BrowserView,
  surface: ElectrobunRendererSurface,
  openLink: (url: string) => void,
) {
  view.on('will-navigate', (event) => {
    const detail = safeDecodeUnknown(willNavigateDetail, eventDetail(event))
    if (!detail.success) return
    // The navigation rules refused it (the page's own documents only); the app opens it instead.
    if (detail.data.allowed) surface.navigated('start', detail.data.url)
    else openLink(detail.data.url)
  })
  // Electrobun's `did-navigate` is a finished load (WebKit `didFinishNavigation`, CEF `OnLoadEnd`,
  // WebView2 `NavigationCompleted`); the port's `did-navigate` is Electron's, a committed document.
  // Taking the finish for the commit counted a document's own first load as a new one, so a slow
  // start dropped the requests the backend gate held for it (`gated-ipc-sender.ts`).
  view.on('did-commit-navigation', (event) => {
    const url = eventDetail(event)
    if (typeof url === 'string') surface.navigated('commit', url)
  })
  view.on('did-navigate-in-page', (event) => {
    const url = eventDetail(event)
    if (typeof url === 'string') surface.navigated('in-page', url)
  })
  // A popup request (`window.open`, a `target="_blank"` or Cmd-clicked link): Electrobun never
  // opens one, it only reports it, so the app decides where the link goes.
  const newWindow = (event: unknown) => {
    const detail = safeDecodeUnknown(newWindowDetail, eventDetail(event))
    if (detail.success) openLink(detail.data.url)
  }
  const events = electrobun().events
  events.on(`new-window-open-${String(view.id)}`, newWindow)
  surface.once('destroyed', () => events.off(`new-window-open-${String(view.id)}`, newWindow))
}

/** Every app webview the shell opened is a surface; its id is the Electrobun webview id. */
export const electrobunRendererSurfaces: RendererSurfacesShape = {
  fromId: (id) => surfaces.get(id) ?? null,
}
