import type {
  BrowserPreviewRecordingGrant,
  BrowserPreviewRecordingMimeType,
} from '@shared/types/browser-preview-controls'
import {
  BROWSER_PREVIEW_CAPTURE_LIMITS,
  BROWSER_PREVIEW_RECORDING_MIME_TYPES,
} from '@shared/types/browser-preview-controls'
import type { BrowserPreviewRecordingEnvironment } from './browser-preview-recording-types'

const RECORDER_START_TIMEOUT_MS = 1_000
const MIN_VIDEO_BITRATE = 2_500_000
const MAX_VIDEO_BITRATE = 50_000_000
const BITS_PER_PIXEL_FRAME = 0.05
const DEFAULT_CAPTURE_WIDTH = 1_920
const DEFAULT_CAPTURE_HEIGHT = 1_080
const DEFAULT_CAPTURE_FRAME_RATE = 30

function positiveSetting(value: number | undefined, fallback: number) {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
}

/** Preserve text and motion at the actual captured resolution without unbounded encoder load. */
export function browserPreviewRecordingBitrate(settings: MediaTrackSettings = {}) {
  const width = positiveSetting(settings.width, DEFAULT_CAPTURE_WIDTH)
  const height = positiveSetting(settings.height, DEFAULT_CAPTURE_HEIGHT)
  const frameRate = positiveSetting(settings.frameRate, DEFAULT_CAPTURE_FRAME_RATE)
  return Math.round(
    Math.min(
      MAX_VIDEO_BITRATE,
      Math.max(MIN_VIDEO_BITRATE, width * height * frameRate * BITS_PER_PIXEL_FRAME),
    ),
  )
}

export const DEFAULT_BROWSER_PREVIEW_RECORDING_ENVIRONMENT: BrowserPreviewRecordingEnvironment = {
  getDisplayMedia: (constraints) => navigator.mediaDevices.getDisplayMedia(constraints),
  createMediaRecorder: (stream, options) => new MediaRecorder(stream, options),
  isTypeSupported: (mimeType) => MediaRecorder.isTypeSupported(mimeType),
  now: () => performance.now(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => clearTimeout(timer),
}

function boundedLimit(value: number, maximum: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Browser preview recording ${label} must be a positive finite number.`)
  }
  return Math.max(1, Math.min(Math.floor(value), maximum))
}

export function boundedBrowserPreviewRecordingGrant(
  grant: BrowserPreviewRecordingGrant,
): BrowserPreviewRecordingGrant {
  return {
    maxBytes: boundedLimit(
      grant.maxBytes,
      BROWSER_PREVIEW_CAPTURE_LIMITS.RECORDING_BYTES,
      'byte limit',
    ),
    maxDurationMs: boundedLimit(
      grant.maxDurationMs,
      BROWSER_PREVIEW_CAPTURE_LIMITS.RECORDING_DURATION_MS,
      'duration limit',
    ),
    maxFrameRate: boundedLimit(
      grant.maxFrameRate,
      BROWSER_PREVIEW_CAPTURE_LIMITS.RECORDING_FRAME_RATE,
      'frame-rate limit',
    ),
  }
}

export function selectBrowserPreviewRecordingMimeType(
  isTypeSupported: BrowserPreviewRecordingEnvironment['isTypeSupported'],
): BrowserPreviewRecordingMimeType {
  for (const candidate of BROWSER_PREVIEW_RECORDING_MIME_TYPES) {
    if (isTypeSupported(candidate)) return candidate
  }
  throw new Error('This Electron runtime does not support a browser preview recording format.')
}

export function stopBrowserPreviewRecordingTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

export function waitForBrowserPreviewRecorderActive(
  recorder: MediaRecorder,
  environment: BrowserPreviewRecordingEnvironment,
): Promise<void> {
  if (recorder.state === 'recording') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      environment.clearTimer(timer)
      recorder.removeEventListener('start', handleStart)
      recorder.removeEventListener('error', handleError)
    }
    const handleStart = () => {
      cleanup()
      if (recorder.state === 'recording') resolve()
      else reject(new Error('Browser preview recording did not enter an active state.'))
    }
    const handleError = () => {
      cleanup()
      reject(new Error('Browser preview recording failed while starting.'))
    }
    const timer = environment.setTimer(() => {
      cleanup()
      reject(new Error('Browser preview recording did not enter an active state.'))
    }, RECORDER_START_TIMEOUT_MS)
    recorder.addEventListener('start', handleStart, { once: true })
    recorder.addEventListener('error', handleError, { once: true })
    if (recorder.state === 'recording') handleStart()
  })
}

export function describeBrowserPreviewRecordingError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
