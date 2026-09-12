import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  NativeImage,
  WebContents,
} from 'electron'
import { captureBrowserPreviewPage } from './browser-preview-capture'
import {
  boundedPictureInPictureOperation,
  buildBrowserPreviewPictureInPictureUrl,
} from './browser-preview-picture-in-picture-operation'
import { createBrowserWindow, isAutomationMode, revealBrowserWindowInactive } from './desktop-ui'

export { buildBrowserPreviewPictureInPictureUrl } from './browser-preview-picture-in-picture-operation'

const INITIAL_WIDTH = 480
const INITIAL_HEIGHT = 320
const MIN_WIDTH = 240
const MIN_HEIGHT = 160
const FRAME_INTERVAL_MS = 100
const FRAME_JPEG_QUALITY = 75
const FRAME_MAX_DIMENSION = 1_280
const FRAME_MAX_BYTES = 4 * 1024 * 1024
const MAX_WINDOWS = 4
const ASPECT_RATIO_EPSILON = 0.002
const FRAME_CONTENT_SCALE = 2
const FIRST_NON_CONTROL_CODE_POINT = 32
const DELETE_CODE_POINT = 127
const MAX_WINDOW_TITLE_LENGTH = 200

export type BrowserPreviewPictureInPictureUnavailableReason = 'automation' | 'capacity'

export class BrowserPreviewPictureInPictureUnavailableError extends Error {
  readonly code = 'BROWSER_PREVIEW_PICTURE_IN_PICTURE_UNAVAILABLE'

  constructor(readonly reason: BrowserPreviewPictureInPictureUnavailableReason) {
    super(
      reason === 'automation'
        ? 'Picture-in-picture is unavailable during non-disruptive automation.'
        : `At most ${String(MAX_WINDOWS)} browser picture-in-picture windows may be open.`,
    )
    this.name = 'BrowserPreviewPictureInPictureUnavailableError'
  }
}

export interface BrowserPreviewPictureInPictureDependencies {
  readonly createWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow
  readonly isAutomation: () => boolean
  readonly platform: NodeJS.Platform
  readonly onClosed: (previewId: string) => void
}

interface PictureInPictureSession {
  readonly previewId: string
  readonly target: WebContents
  readonly window: BrowserWindow
  readonly abortController: AbortController
  timer: ReturnType<typeof setTimeout> | null
  lastFrame: Buffer | null
  aspectRatio: number | null
  published: boolean
}

const DEFAULT_DEPENDENCIES: BrowserPreviewPictureInPictureDependencies = {
  createWindow: createBrowserWindow,
  isAutomation: isAutomationMode,
  platform: process.platform,
  onClosed: () => undefined,
}

export function fitBrowserPreviewPictureInPictureSize(
  currentSize: readonly number[],
  aspectRatio: number,
): readonly [number, number] {
  const currentWidth = Math.max(1, currentSize[0] ?? INITIAL_WIDTH)
  const currentHeight = Math.max(1, currentSize[1] ?? INITIAL_HEIGHT)
  const area = currentWidth * currentHeight
  let width = Math.sqrt(area * aspectRatio)
  let height = width / aspectRatio
  const minimumScale = Math.max(1, MIN_WIDTH / width, MIN_HEIGHT / height)
  width *= minimumScale
  height *= minimumScale
  return [Math.round(width), Math.round(height)]
}

function boundedFrame(image: NativeImage, contentSize: readonly number[]): NativeImage | null {
  if (image.isEmpty()) return null
  const size = image.getSize()
  if (size.width <= 0 || size.height <= 0) return null
  const contentWidth = Math.max(1, contentSize[0] ?? INITIAL_WIDTH)
  const contentHeight = Math.max(1, contentSize[1] ?? INITIAL_HEIGHT)
  const maxWidth = Math.min(FRAME_MAX_DIMENSION, contentWidth * FRAME_CONTENT_SCALE)
  const maxHeight = Math.min(FRAME_MAX_DIMENSION, contentHeight * FRAME_CONTENT_SCALE)
  const scale = Math.min(1, maxWidth / size.width, maxHeight / size.height)
  if (scale >= 1) return image
  return image.resize({
    width: Math.max(1, Math.floor(size.width * scale)),
    height: Math.max(1, Math.floor(size.height * scale)),
    quality: 'good',
  })
}

function deliverFrameExpression(frame: Buffer) {
  const source = `data:image/jpeg;base64,${frame.toString('base64')}`
  return `(() => { const image = document.getElementById('openwaggle-preview-frame'); if (!(image instanceof HTMLImageElement)) return false; image.src = ${JSON.stringify(source)}; return true })()`
}

function safeWindowTitle(title: string) {
  return Array.from(title, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint < FIRST_NON_CONTROL_CODE_POINT || codePoint === DELETE_CODE_POINT
      ? ' '
      : character
  })
    .join('')
    .trim()
    .slice(0, MAX_WINDOW_TITLE_LENGTH)
}

export class BrowserPreviewPictureInPictureController {
  private readonly sessions = new Map<string, PictureInPictureSession>()
  private readonly dependencies: BrowserPreviewPictureInPictureDependencies

  constructor(dependencies: Partial<BrowserPreviewPictureInPictureDependencies> = {}) {
    this.dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies }
  }

  async open(previewId: string, target: WebContents, title: string): Promise<'opened' | 'focused'> {
    if (this.dependencies.isAutomation()) {
      throw new BrowserPreviewPictureInPictureUnavailableError('automation')
    }
    const existing = this.sessions.get(previewId)
    if (existing && !existing.window.isDestroyed()) {
      revealBrowserWindowInactive(existing.window)
      return 'focused'
    }
    if (existing) this.release(existing, false)
    if (this.sessions.size >= MAX_WINDOWS) {
      throw new BrowserPreviewPictureInPictureUnavailableError('capacity')
    }
    if (target.isDestroyed()) throw new Error('Browser preview content is no longer available.')

    const window = this.dependencies.createWindow(this.windowOptions(title))
    const session: PictureInPictureSession = {
      previewId,
      target,
      window,
      abortController: new AbortController(),
      timer: null,
      lastFrame: null,
      aspectRatio: null,
      published: false,
    }
    this.sessions.set(previewId, session)

    try {
      window.once('closed', () => this.release(session, false))
      window.setAlwaysOnTop(true, this.dependencies.platform === 'darwin' ? 'floating' : 'normal')
      if (this.dependencies.platform === 'darwin') {
        window.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
          skipTransformProcessType: true,
        })
      }
      await boundedPictureInPictureOperation(
        window.loadURL(buildBrowserPreviewPictureInPictureUrl()),
        session.abortController.signal,
        'load',
      )
      if (!this.isCurrent(session) || target.isDestroyed()) {
        throw new Error('Browser preview changed while picture-in-picture was opening.')
      }
      await this.captureAndDeliver(session)
      if (!this.isCurrent(session)) {
        throw new Error('Picture-in-picture closed before it became visible.')
      }
      revealBrowserWindowInactive(window)
      session.published = true
      this.schedule(session)
      return 'opened'
    } catch (error) {
      this.release(session, true)
      throw error
    }
  }

  close(previewId: string): void {
    const session = this.sessions.get(previewId)
    if (session) this.release(session, true)
  }

  closeForContents(contents: WebContents): void {
    for (const session of [...this.sessions.values()]) {
      if (session.target === contents) this.release(session, true)
    }
  }

  closeAll(): void {
    for (const session of [...this.sessions.values()]) this.release(session, true)
  }

  isOpen(previewId: string): boolean {
    const session = this.sessions.get(previewId)
    return session !== undefined && !session.window.isDestroyed()
  }

  private windowOptions(title: string): BrowserWindowConstructorOptions {
    const safeTitle = safeWindowTitle(title)
    return {
      width: INITIAL_WIDTH,
      height: INITIAL_HEIGHT,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      title: safeTitle ? `Preview · ${safeTitle}` : 'Browser preview',
      show: false,
      alwaysOnTop: true,
      autoHideMenuBar: true,
      fullscreenable: false,
      maximizable: false,
      minimizable: false,
      resizable: true,
      skipTaskbar: true,
      backgroundColor: '#111111',
      ...(this.dependencies.platform === 'darwin' ? { type: 'panel' as const } : {}),
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        devTools: false,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        webSecurity: true,
        partition: 'openwaggle-browser-preview-picture-in-picture',
      },
    }
  }

  private schedule(session: PictureInPictureSession): void {
    if (!this.isCurrent(session)) return
    session.timer = setTimeout(() => {
      session.timer = null
      void this.captureAndDeliver(session)
        .catch(() => this.release(session, true))
        .finally(() => this.schedule(session))
    }, FRAME_INTERVAL_MS)
    session.timer.unref()
  }

  private async captureAndDeliver(session: PictureInPictureSession): Promise<void> {
    if (!this.isCurrent(session)) return
    if (session.target.isDestroyed()) {
      this.release(session, true)
      return
    }
    const source = await captureBrowserPreviewPage(session.target, {
      signal: session.abortController.signal,
      assertCurrent: () => {
        if (!this.isCurrent(session)) {
          throw new Error('Picture-in-picture closed while its frame was being captured.')
        }
      },
    })
    if (!this.isCurrent(session)) return
    const image = boundedFrame(source, session.window.getContentSize())
    if (image === null) return
    const size = image.getSize()
    const frame = image.toJPEG(FRAME_JPEG_QUALITY)
    if (frame.byteLength === 0 || frame.byteLength > FRAME_MAX_BYTES) return
    if (session.lastFrame?.equals(frame)) return
    const aspectRatio = size.width / size.height
    if (
      session.aspectRatio === null ||
      Math.abs(session.aspectRatio - aspectRatio) > ASPECT_RATIO_EPSILON
    ) {
      const [width, height] = fitBrowserPreviewPictureInPictureSize(
        session.window.getContentSize(),
        aspectRatio,
      )
      session.window.setAspectRatio(0)
      session.window.setContentSize(width, height, false)
      session.window.setAspectRatio(aspectRatio)
      session.aspectRatio = aspectRatio
    }
    const delivered: unknown = await boundedPictureInPictureOperation(
      session.window.webContents.executeJavaScript(deliverFrameExpression(frame)),
      session.abortController.signal,
      'frame-delivery',
    )
    if (delivered === true && this.isCurrent(session)) session.lastFrame = frame
  }

  private isCurrent(session: PictureInPictureSession): boolean {
    return (
      this.sessions.get(session.previewId) === session &&
      !session.window.isDestroyed() &&
      !session.window.webContents.isDestroyed()
    )
  }

  private release(session: PictureInPictureSession, closeWindow: boolean): void {
    if (this.sessions.get(session.previewId) !== session) return
    this.sessions.delete(session.previewId)
    session.abortController.abort(new Error('Picture-in-picture closed.'))
    if (session.timer !== null) clearTimeout(session.timer)
    session.timer = null
    session.lastFrame = null
    if (closeWindow) {
      try {
        if (!session.window.isDestroyed()) session.window.close()
      } catch {
        try {
          if (!session.window.isDestroyed()) session.window.destroy()
        } catch {
          // The session is already detached; continue notifying renderer state.
        }
      }
    }
    if (session.published) {
      try {
        this.dependencies.onClosed(session.previewId)
      } catch {
        // An observer failure must not resurrect or strand this native session.
      }
    }
  }
}
