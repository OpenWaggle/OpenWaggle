import type { BrowserPreviewControllerState } from '@shared/types/browser-preview'

/**
 * The page the Browser preview automation drives, in the shape every desktop shell gives it (ADR 0064):
 * the Chrome DevTools Protocol through `debugger`, the page's lifecycle events, and the human
 * input the shell sees before the page does. Electron's `WebContents` has this shape; the
 * Electrobun shell builds it over CEF's DevTools endpoint.
 */

/** A key event a human sent to the page, as the shell reports it before the page sees it. */
export interface BrowserPreviewAutomationKeyInput {
  readonly type: string
  readonly key: string
  readonly code: string
  readonly location: number
  readonly alt: boolean
  readonly control: boolean
  readonly meta: boolean
  readonly shift: boolean
}

/** A mouse event a human sent to the page; wheel events also carry `deltaX` and `deltaY`. */
export interface BrowserPreviewAutomationMouseInput {
  readonly type: string
  readonly x: number
  readonly y: number
  readonly button?: string
  readonly modifiers?: readonly string[]
}

/** A captured frame of the page; a shell that cannot scale an image captures it again, smaller. */
export interface BrowserPreviewAutomationImage {
  isEmpty(): boolean
  getSize(): { readonly width: number; readonly height: number }
  resize(size: {
    readonly width: number
    readonly height: number
  }): BrowserPreviewAutomationImage | Promise<BrowserPreviewAutomationImage>
  toPNG(): Uint8Array
}

export interface BrowserPreviewAutomationClip {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type BrowserPreviewCdpMessageListener = (
  event: unknown,
  method: string,
  params: unknown,
) => void
export type BrowserPreviewCdpDetachListener = (event: unknown, reason: string) => void

/** The page's DevTools Protocol connection. */
export interface BrowserPreviewAutomationDebugger {
  attach(protocolVersion?: string): void
  detach(): void
  isAttached(): boolean
  sendCommand(method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown>
  on(event: 'message', listener: BrowserPreviewCdpMessageListener): unknown
  on(event: 'detach', listener: BrowserPreviewCdpDetachListener): unknown
  removeListener(event: 'message', listener: BrowserPreviewCdpMessageListener): unknown
  removeListener(event: 'detach', listener: BrowserPreviewCdpDetachListener): unknown
}

export type BrowserPreviewKeyListener = (
  event: unknown,
  input: BrowserPreviewAutomationKeyInput,
) => void
export type BrowserPreviewMouseListener = (
  event: unknown,
  input: BrowserPreviewAutomationMouseInput,
) => void
export type BrowserPreviewNavigationListener = (
  event: unknown,
  url: string,
  isInPlace: boolean,
  isMainFrame: boolean,
) => void

export interface BrowserPreviewAutomationContents {
  readonly id: number
  readonly debugger: BrowserPreviewAutomationDebugger
  isDestroyed(): boolean
  isDevToolsOpened(): boolean
  getBackgroundThrottling(): boolean
  setBackgroundThrottling(allowed: boolean): void
  focus(): void
  /** Asks the compositor for a new frame, after a capture that never finished. */
  invalidate(): void
  capturePage(clip?: BrowserPreviewAutomationClip): Promise<BrowserPreviewAutomationImage>
  on(event: 'before-input-event', listener: BrowserPreviewKeyListener): unknown
  on(event: 'before-mouse-event', listener: BrowserPreviewMouseListener): unknown
  on(event: 'did-start-navigation', listener: BrowserPreviewNavigationListener): unknown
  on(event: 'destroyed', listener: () => void): unknown
  once(event: 'destroyed', listener: () => void): unknown
  removeListener(event: 'before-input-event', listener: BrowserPreviewKeyListener): unknown
  removeListener(event: 'before-mouse-event', listener: BrowserPreviewMouseListener): unknown
  removeListener(event: 'did-start-navigation', listener: BrowserPreviewNavigationListener): unknown
  removeListener(event: 'destroyed', listener: () => void): unknown
}

/** A page as the automation controller addresses it: one per preview tab. */
export interface BrowserPreviewAutomationPage {
  readonly tabId: string
  readonly contents: BrowserPreviewAutomationContents
  /** The page that had keyboard focus, so a key press can hand focus back. */
  readonly focusedContents?: () => Pick<
    BrowserPreviewAutomationContents,
    'id' | 'focus' | 'isDestroyed'
  > | null
  readonly onControllerChange?: (state: BrowserPreviewControllerState) => void
}

const retiredContents = new WeakSet<object>()

/** Cached automation pages must not regain access after their renderer owner retires. */
export function retireBrowserPreviewContents(contents: object): void {
  retiredContents.add(contents)
}

export function assertBrowserPreviewContentsAvailable(contents: object): void {
  if (retiredContents.has(contents)) {
    throw new Error('Browser preview owner is retired; only native close cleanup is available.')
  }
}
