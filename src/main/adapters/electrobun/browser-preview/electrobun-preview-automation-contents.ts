import { EventEmitter } from 'node:events'
import {
  type BrowserPreviewAutomationClip,
  type BrowserPreviewAutomationContents,
  type BrowserPreviewAutomationDebugger,
  type BrowserPreviewAutomationImage,
  type BrowserPreviewCdpDetachListener,
  type BrowserPreviewCdpMessageListener,
  type BrowserPreviewKeyListener,
  type BrowserPreviewMouseListener,
  type BrowserPreviewNavigationListener,
  retireBrowserPreviewContents,
} from '../../browser-preview/automation/browser-preview-automation-contents'

type DebuggerListener = BrowserPreviewCdpMessageListener | BrowserPreviewCdpDetachListener
import {
  captureCefPng,
  type CdpSend,
  type CefClip,
  documentClip,
  pngDimensions,
  visibleRegion,
} from './electrobun-preview-screenshots'
import type { ElectrobunPreviewGuest } from './electrobun-preview-guest'
import type { ElectrobunPreviewRecord } from './electrobun-preview-records'
import type { CdpCommandParams } from '../../browser-preview/automation/browser-preview-cdp-input-params'

/**
 * A CEF preview as the agent's automation drives it (ADR 0064): the page's own CDP connection
 * stands in for Electron's `webContents.debugger`. Unlike Electron, the shell sees no human input
 * before the page does, so a person typing into a preview does not interrupt an agent's action
 * there, and DevTools never takes the page from the agent: CEF serves both over the same endpoint.
 */

/** The domains the automation enables for its diagnostics, turned off when it lets go. */
const AUTOMATION_DOMAINS = ['Accessibility', 'Network', 'Log'] as const

class CefAutomationDebugger implements BrowserPreviewAutomationDebugger {
  private attached = false
  private readonly events = new EventEmitter()
  private readonly guest: ElectrobunPreviewGuest

  constructor(guest: ElectrobunPreviewGuest) {
    this.guest = guest
    guest.onCdpEvent((method, params) => this.events.emit('message', null, method, params))
    guest.onCdpClose(() => {
      if (!this.attached) return
      this.attached = false
      this.events.emit('detach', null, 'target closed')
    })
  }

  attach() {
    this.attached = true
  }

  detach() {
    this.attached = false
    for (const domain of AUTOMATION_DOMAINS) {
      void this.guest.send(`${domain}.disable`).catch(() => undefined)
    }
  }

  isAttached() {
    return this.attached
  }

  sendCommand(method: string, params: CdpCommandParams = {}) {
    return this.guest.send(method, params)
  }

  on(event: 'message', listener: BrowserPreviewCdpMessageListener): this
  on(event: 'detach', listener: BrowserPreviewCdpDetachListener): this
  on(event: string, listener: DebuggerListener): this {
    this.events.on(event, listener)
    return this
  }

  removeListener(event: 'message', listener: BrowserPreviewCdpMessageListener): this
  removeListener(event: 'detach', listener: BrowserPreviewCdpDetachListener): this
  removeListener(event: string, listener: DebuggerListener): this {
    this.events.removeListener(event, listener)
    return this
  }
}

/**
 * A PNG of the page. CEF captures at the page's device pixels and the main process has no image
 * library, so a smaller version is captured again at a CDP scale instead of scaled here.
 */
class CefScreenshot implements BrowserPreviewAutomationImage {
  private readonly png: Uint8Array
  private readonly send: CdpSend
  private readonly clip: CefClip | undefined

  constructor(png: Uint8Array, send: CdpSend, clip?: CefClip) {
    this.png = png
    this.send = send
    this.clip = clip
  }

  isEmpty() {
    return this.png.byteLength === 0
  }

  getSize() {
    return pngDimensions(this.png)
  }

  async resize(size: { readonly width: number }) {
    const region = this.clip ?? (await visibleRegion(this.send))
    const clip = { ...region, scale: region.scale * (size.width / this.getSize().width) }
    return new CefScreenshot(await captureCefPng(this.send, clip), this.send, clip)
  }

  toPNG() {
    return this.png
  }
}

type ContentsListener =
  | BrowserPreviewKeyListener
  | BrowserPreviewMouseListener
  | BrowserPreviewNavigationListener
  | (() => void)

class CefAutomationContents implements BrowserPreviewAutomationContents {
  readonly id: number
  readonly debugger: CefAutomationDebugger
  private backgroundThrottling = true
  private readonly events = new EventEmitter()
  private readonly record: ElectrobunPreviewRecord

  constructor(record: ElectrobunPreviewRecord) {
    this.record = record
    this.id = record.webviewId
    this.debugger = new CefAutomationDebugger(record.guest)
    // A preview is removed when it closes or its owner page retires. The automation page cached
    // for it then refuses every later action, as Electron's quarantined pages do.
    record.destroyedListeners.push(() => {
      retireBrowserPreviewContents(this)
      this.events.emit('destroyed')
    })
  }

  isDestroyed() {
    return this.record.disposed
  }

  isDevToolsOpened() {
    return false
  }

  getBackgroundThrottling() {
    return this.backgroundThrottling
  }

  /** Recorded only: CEF keeps rendering a preview the window shows, which automation needs. */
  setBackgroundThrottling(allowed: boolean) {
    this.backgroundThrottling = allowed
  }

  focus() {
    void this.record.guest.send('Page.bringToFront').catch(() => undefined)
  }

  /** CDP has no repaint request; the next capture asks CEF for a frame again. */
  invalidate() {
    return undefined
  }

  async capturePage(clip?: BrowserPreviewAutomationClip) {
    // Electron clips the view's viewport; CDP clips the document.
    const send: CdpSend = (method, params) => this.record.guest.send(method, params)
    const region = clip ? await documentClip(send, clip) : undefined
    return new CefScreenshot(await captureCefPng(send, region), send, region)
  }

  on(event: 'before-input-event', listener: BrowserPreviewKeyListener): this
  on(event: 'before-mouse-event', listener: BrowserPreviewMouseListener): this
  on(event: 'did-start-navigation', listener: BrowserPreviewNavigationListener): this
  on(event: 'destroyed', listener: () => void): this
  on(event: string, listener: ContentsListener): this {
    this.events.on(event, listener)
    return this
  }

  once(event: string, listener: () => void) {
    this.events.once(event, listener)
    return this
  }

  removeListener(event: 'before-input-event', listener: BrowserPreviewKeyListener): this
  removeListener(event: 'before-mouse-event', listener: BrowserPreviewMouseListener): this
  removeListener(event: 'did-start-navigation', listener: BrowserPreviewNavigationListener): this
  removeListener(event: 'destroyed', listener: () => void): this
  removeListener(event: string, listener: ContentsListener): this {
    this.events.removeListener(event, listener)
    return this
  }
}

const contentsByRecord = new WeakMap<ElectrobunPreviewRecord, BrowserPreviewAutomationContents>()

/** The one automation page of a CEF preview, so its control session survives between actions. */
export function cefAutomationContents(record: ElectrobunPreviewRecord) {
  const existing = contentsByRecord.get(record)
  if (existing) return existing
  const contents: BrowserPreviewAutomationContents = new CefAutomationContents(record)
  contentsByRecord.set(record, contents)
  return contents
}
