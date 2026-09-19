import type { NativeImage, Rectangle, WebContents } from 'electron'
import { assertBrowserPreviewContentsAvailable } from './browser-preview-quarantine'

const CAPTURE_ATTEMPTS = 3
const CAPTURE_ATTEMPT_TIMEOUT_MS = 1_000
const CAPTURE_RETRY_DELAY_MS = 120

interface CaptureRequest {
  active: boolean
}

interface CaptureLane {
  tail: Promise<void>
}

export interface BrowserPreviewCaptureOptions {
  readonly clip?: Rectangle
  readonly signal?: AbortSignal
  readonly assertCurrent?: () => void
}

const captureLanes = new WeakMap<WebContents, CaptureLane>()

export class BrowserPreviewCaptureTimeoutError extends Error {
  constructor() {
    super(
      `Browser preview capture did not finish after ${String(CAPTURE_ATTEMPTS)} bounded attempts.`,
    )
    this.name = 'BrowserPreviewCaptureTimeoutError'
  }
}

function cancellationError(signal?: AbortSignal) {
  return signal?.reason instanceof Error && signal.reason.name !== 'AbortError'
    ? signal.reason
    : new Error('Browser preview capture was cancelled.')
}

function requireCurrent(
  contents: WebContents,
  request: CaptureRequest,
  assertCurrent?: () => void,
) {
  assertBrowserPreviewContentsAvailable(contents)
  if (!request.active) throw new Error('Browser preview capture request has ended.')
  if (contents.isDestroyed()) throw new Error('Browser preview content is no longer available.')
  assertCurrent?.()
}

function captureLane(contents: WebContents) {
  const existing = captureLanes.get(contents)
  if (existing) return existing
  const lane: CaptureLane = { tail: Promise.resolve() }
  captureLanes.set(contents, lane)
  return lane
}

function enqueueNativeCapture(
  contents: WebContents,
  request: CaptureRequest,
  options: BrowserPreviewCaptureOptions,
) {
  const lane = captureLane(contents)
  const completion = lane.tail.then(() => {
    requireCurrent(contents, request, options.assertCurrent)
    return contents.capturePage(options.clip)
  })
  lane.tail = completion.then(
    () => undefined,
    () => undefined,
  )
  return completion
}

function boundedAttempt(
  completion: Promise<NativeImage>,
  signal?: AbortSignal,
): Promise<NativeImage> {
  if (signal?.aborted) return Promise.reject(cancellationError(signal))
  return new Promise<NativeImage>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      finish(() => reject(new BrowserPreviewCaptureTimeoutError()))
    }, CAPTURE_ATTEMPT_TIMEOUT_MS)
    timeout.unref()
    const onAbort = () => finish(() => reject(cancellationError(signal)))
    const finish = (settle: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      settle()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    completion.then(
      (image) => finish(() => resolve(image)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

function retryDelay(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(cancellationError(signal))
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(finish, CAPTURE_RETRY_DELAY_MS)
    timeout.unref()
    const onAbort = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      reject(cancellationError(signal))
    }
    function finish() {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function requestRepaint(contents: WebContents) {
  if (contents.isDestroyed()) return
  try {
    contents.invalidate()
  } catch {
    // A renderer can disappear between the live check and compositor invalidation.
  }
}

/**
 * Captures one compositor frame without overlapping native capturePage calls for the same page.
 * A timed-out native promise remains serialized until Electron settles it, while every caller and
 * automation queue still receives a bounded failure.
 */
export async function captureBrowserPreviewPage(
  contents: WebContents,
  options: BrowserPreviewCaptureOptions = {},
): Promise<NativeImage> {
  const request: CaptureRequest = { active: true }
  let completion: Promise<NativeImage> | undefined
  try {
    for (let attempt = 0; attempt < CAPTURE_ATTEMPTS; attempt += 1) {
      requireCurrent(contents, request, options.assertCurrent)
      completion ??= enqueueNativeCapture(contents, request, options)
      try {
        const image = await boundedAttempt(completion, options.signal)
        requireCurrent(contents, request, options.assertCurrent)
        return image
      } catch (error) {
        requireCurrent(contents, request, options.assertCurrent)
        if (!(error instanceof BrowserPreviewCaptureTimeoutError)) completion = undefined
        if (attempt === CAPTURE_ATTEMPTS - 1) throw error
        if (error instanceof BrowserPreviewCaptureTimeoutError) requestRepaint(contents)
        await retryDelay(options.signal)
      }
    }
    throw new BrowserPreviewCaptureTimeoutError()
  } finally {
    request.active = false
  }
}
