import { Context } from 'effect'

/** Where a navigation that started in a renderer surface is going. */
export interface RendererSurfaceNavigationStart {
  readonly url: string
  readonly isMainFrame: boolean
  readonly isSameDocument: boolean
}

/**
 * One loaded web page the shell renders: the app's own window page today, and any other page the
 * main process sends events to or tracks. Its `id` is stable for the surface's life and unique in
 * the process; IPC requests carry it as the sender.
 *
 * Lifecycle events every shell emits with these meanings:
 * - `did-start-navigation`: a navigation began, before it commits;
 * - `did-navigate`: a main-frame navigation committed a new document (a reload included);
 * - `render-process-gone`: the page's renderer crashed or was killed, so its document is gone;
 * - `destroyed`: the surface closed for good; it emits nothing after this.
 *
 * Electron's `WebContents` has this shape as is. Electrobun wraps a `BrowserView`.
 */
export interface RendererSurface {
  readonly id: number
  isDestroyed(): boolean
  getURL(): string
  /** Delivers one IPC event to the page (`window.api.on(channel)`). */
  send(channel: string, ...args: unknown[]): void
  focus(): void
  on(event: 'destroyed', listener: () => void): this
  on(event: 'did-navigate', listener: () => void): this
  on(event: 'render-process-gone', listener: () => void): this
  on(
    event: 'did-start-navigation',
    listener: (navigation: RendererSurfaceNavigationStart) => void,
  ): this
  once(event: 'destroyed', listener: () => void): this
  once(event: 'render-process-gone', listener: () => void): this
  removeListener(event: 'destroyed', listener: () => void): this
  removeListener(event: 'did-navigate', listener: () => void): this
  removeListener(event: 'render-process-gone', listener: () => void): this
  removeListener(
    event: 'did-start-navigation',
    listener: (navigation: RendererSurfaceNavigationStart) => void,
  ): this
}

/** Finds the renderer surfaces of this process by id. */
export interface RendererSurfacesShape {
  /** The live surface with this id, or `null` once it is gone. */
  readonly fromId: (id: number) => RendererSurface | null
}

export class RendererSurfaces extends Context.Tag('@openwaggle/RendererSurfaces')<
  RendererSurfaces,
  RendererSurfacesShape
>() {}
