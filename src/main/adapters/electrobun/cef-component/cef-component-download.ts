import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import type { BrowserEngineFailureReason } from '@shared/types/browser-engine'
import type { CefComponentAsset } from './cef-component-manifest'

/** A failed install step, with the reason the renderer explains it by. */
export class CefComponentError extends Error {
  readonly reason: BrowserEngineFailureReason

  constructor(reason: BrowserEngineFailureReason, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CefComponentError'
    this.reason = reason
  }
}

export interface CefDownloadProgress {
  readonly receivedBytes: number
  readonly totalBytes: number
}

/** Progress is reported this many times over a download, plus once at its end. */
const PROGRESS_REPORTS = 200
const HEX = 'hex'
/** A download that receives nothing for this long has lost its connection. */
const CEF_DOWNLOAD_STALL_MS = 60_000

export type CefComponentFetch = (
  url: string,
  init: { readonly signal: AbortSignal },
) => Promise<Response>

export interface CefArchiveDownload {
  readonly fetch: CefComponentFetch
  readonly asset: CefComponentAsset
  readonly destination: string
  readonly onProgress: (progress: CefDownloadProgress) => void
  readonly stallMs?: number
}

/** Aborts the request once no byte arrived for `stallMs`; every chunk restarts the clock. */
class StallWatchdog {
  private readonly controller = new AbortController()
  private timer: ReturnType<typeof setTimeout> | undefined
  readonly stalled: Promise<never>

  private readonly stallMs: number

  constructor(stallMs: number) {
    this.stallMs = stallMs
    this.stalled = new Promise<never>((_resolve, reject) => {
      this.controller.signal.addEventListener('abort', () =>
        reject(new CefComponentError('offline', 'The download stalled.')),
      )
    })
    this.stalled.catch(() => undefined)
    this.touch()
  }

  get signal() {
    return this.controller.signal
  }

  touch() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.controller.abort(), this.stallMs)
  }

  stop() {
    clearTimeout(this.timer)
  }
}

async function request(fetch: CefComponentFetch, url: string, watchdog: StallWatchdog) {
  let response: Response
  try {
    response = await Promise.race([fetch(url, { signal: watchdog.signal }), watchdog.stalled])
  } catch (error) {
    if (error instanceof CefComponentError) throw error
    throw new CefComponentError('offline', 'The download server could not be reached.', {
      cause: error,
    })
  }
  if (!response.ok || response.body === null) {
    throw new CefComponentError(
      'http',
      `The download server answered ${String(response.status)} ${response.statusText}`.trim(),
    )
  }
  return response.body.getReader()
}

function tooLarge(asset: CefComponentAsset) {
  return new CefComponentError(
    'integrity',
    `The download is larger than the expected ${String(asset.size)} bytes.`,
  )
}

async function nextChunk(reader: ReadableStreamDefaultReader<Uint8Array>, watchdog: StallWatchdog) {
  try {
    return await Promise.race([reader.read(), watchdog.stalled])
  } catch (error) {
    if (error instanceof CefComponentError) throw error
    throw new CefComponentError('offline', 'The download was interrupted.', { cause: error })
  } finally {
    watchdog.touch()
  }
}

async function append(file: fs.FileHandle, chunk: Uint8Array) {
  try {
    await file.write(chunk)
  } catch (error) {
    throw new CefComponentError('install', 'The download could not be saved to disk.', {
      cause: error,
    })
  }
}

/**
 * Streams the archive to `destination`, hashing it as it arrives, and fails closed: a response
 * that is longer, shorter or hashes differently than the manifest pins is rejected.
 */
export async function downloadCefArchive(download: CefArchiveDownload): Promise<void> {
  const watchdog = new StallWatchdog(download.stallMs ?? CEF_DOWNLOAD_STALL_MS)
  try {
    await receive(download, watchdog)
  } finally {
    watchdog.stop()
  }
}

async function receive(download: CefArchiveDownload, watchdog: StallWatchdog) {
  const { asset } = download
  const reader = await request(download.fetch, asset.url, watchdog)
  const hash = createHash('sha256')
  const step = Math.max(1, Math.floor(asset.size / PROGRESS_REPORTS))
  const file = await fs.open(download.destination, 'wx')
  let receivedBytes = 0
  let reportedBytes = 0
  download.onProgress({ receivedBytes, totalBytes: asset.size })
  try {
    while (true) {
      const { done, value } = await nextChunk(reader, watchdog)
      if (done) break
      receivedBytes += value.byteLength
      if (receivedBytes > asset.size) throw tooLarge(asset)
      hash.update(value)
      await append(file, value)
      if (receivedBytes - reportedBytes >= step || receivedBytes === asset.size) {
        reportedBytes = receivedBytes
        download.onProgress({ receivedBytes, totalBytes: asset.size })
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    await file.close()
  }
  if (receivedBytes !== asset.size) {
    throw new CefComponentError(
      'integrity',
      `The download ended after ${String(receivedBytes)} of ${String(asset.size)} bytes.`,
    )
  }
  if (hash.digest(HEX) !== asset.sha256) {
    throw new CefComponentError('integrity', 'The download does not match its pinned checksum.')
  }
}
