import { EventEmitter } from 'node:events'
import { Schema } from '@shared/schema'
import type {
  BrowserPreviewAutomationClip,
  BrowserPreviewAutomationContents,
  BrowserPreviewAutomationDebugger,
  BrowserPreviewAutomationImage,
  BrowserPreviewCdpDetachListener,
  BrowserPreviewCdpMessageListener,
  BrowserPreviewKeyListener,
  BrowserPreviewMouseListener,
  BrowserPreviewNavigationListener,
} from '../../browser-preview/automation/browser-preview-automation-contents'

type DebuggerListener = BrowserPreviewCdpMessageListener | BrowserPreviewCdpDetachListener
import { pngDimensions } from './electrobun-preview-controls'
import { decode, ScreenshotSchema } from './electrobun-preview-cdp-protocol'
import type { ElectrobunPreviewGuest } from './electrobun-preview-guest'
import type { ElectrobunPreviewRecord } from './electrobun-preview-records'

/**
 * A CEF preview as the agent's automation drives it (ADR 0064): the page's own CDP connection
 * stands in for Electron's `webContents.debugger`. Unlike Electron, the shell sees no human input
 * before the page does, so a person typing into a preview does not interrupt an agent's action
 * there, and DevTools never takes the page from the agent: CEF serves both over the same endpoint.
 */

/** The domains the automation enables for its diagnostics, turned off when it lets go. */
const AUTOMATION_DOMAINS = ['Accessibility', 'Network', 'Log'] as const

const LayoutMetricsSchema = Schema.Struct({
  cssVisualViewport: Schema.Struct({
    pageX: Schema.Number,
    pageY: Schema.Number,
    clientWidth: Schema.Number,
    clientHeight: Schema.Number,
  }),
})

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

  attach(): void {
    this.attached = true
  }

  detach(): void {
    this.attached = false
    for (const domain of AUTOMATION_DOMAINS) {
      void this.guest.send(`${domain}.disable`).catch(() => undefined)
    }
  }

  isAttached(): boolean {
    return this.attached
  }

  sendCommand(method: string, params: Readonly<Record<string, unknown>> = {}): Promise<unknown> {
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

async function captureCefPng(guest: ElectrobunPreviewGuest, clip?: CefClip): Promise<Uint8Array> {
  const shot = decode(
    ScreenshotSchema,
    await guest.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) }),
  )
  if (shot === null) throw new Error('The browser preview screenshot is malformed.')
  return Buffer.from(shot.data, 'base64')
}

interface CefClip extends BrowserPreviewAutomationClip {
  readonly scale: number
}

/** The visible part of the page, in CSS pixels. */
async function visibleRegion(guest: ElectrobunPreviewGuest): Promise<CefClip> {
  const metrics = decode(LayoutMetricsSchema, await guest.send('Page.getLayoutMetrics'))
  if (metrics === null) throw new Error('The browser preview layout metrics are malformed.')
  const viewport = metrics.cssVisualViewport
  return {
    x: viewport.pageX,
    y: viewport.pageY,
    width: viewport.clientWidth,
    height: viewport.clientHeight,
    scale: 1,
  }
}

/**
 * A PNG of the page. CEF captures at the page's device pixels and the main process has no image
 * library, so a smaller version is captured again at a CDP scale instead of scaled here.
 */
class CefScreenshot implements BrowserPreviewAutomationImage {
  private readonly png: Uint8Array
  private readonly guest: ElectrobunPreviewGuest
  private readonly clip: CefClip | undefined

  constructor(png: Uint8Array, guest: ElectrobunPreviewGuest, clip?: CefClip) {
    this.png = png
    this.guest = guest
    this.clip = clip
  }

  isEmpty(): boolean {
    return this.png.byteLength === 0
  }

  getSize() {
    return pngDimensions(this.png)
  }

  async resize(size: { readonly width: number }): Promise<BrowserPreviewAutomationImage> {
    const region = this.clip ?? (await visibleRegion(this.guest))
    const clip = { ...region, scale: region.scale * (size.width / this.getSize().width) }
    return new CefScreenshot(await captureCefPng(this.guest, clip), this.guest, clip)
  }

  toPNG(): Uint8Array {
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
    record.destroyedListeners.push(() => this.events.emit('destroyed'))
  }

  isDestroyed(): boolean {
    return this.record.disposed
  }

  isDevToolsOpened(): boolean {
    return false
  }

  getBackgroundThrottling(): boolean {
    return this.backgroundThrottling
  }

  /** Recorded only: CEF keeps rendering a preview the window shows, which automation needs. */
  setBackgroundThrottling(allowed: boolean): void {
    this.backgroundThrottling = allowed
  }

  focus(): void {
    void this.record.guest.send('Page.bringToFront').catch(() => undefined)
  }

  /** CDP has no repaint request; the next capture asks CEF for a frame again. */
  invalidate(): void {
    return undefined
  }

  async capturePage(clip?: BrowserPreviewAutomationClip): Promise<BrowserPreviewAutomationImage> {
    const region = clip ? { ...clip, scale: 1 } : undefined
    return new CefScreenshot(
      await captureCefPng(this.record.guest, region),
      this.record.guest,
      region,
    )
  }

  on(event: 'before-input-event', listener: BrowserPreviewKeyListener): this
  on(event: 'before-mouse-event', listener: BrowserPreviewMouseListener): this
  on(event: 'did-start-navigation', listener: BrowserPreviewNavigationListener): this
  on(event: 'destroyed', listener: () => void): this
  on(event: string, listener: ContentsListener): this {
    this.events.on(event, listener)
    return this
  }

  once(event: string, listener: () => void): this {
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

const contentsByRecord = new WeakMap<ElectrobunPreviewRecord, CefAutomationContents>()

/** The one automation page of a CEF preview, so its control session survives between actions. */
export function cefAutomationContents(record: ElectrobunPreviewRecord): CefAutomationContents {
  const existing = contentsByRecord.get(record)
  if (existing) return existing
  const contents = new CefAutomationContents(record)
  contentsByRecord.set(record, contents)
  return contents
}
