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

export interface CefArchiveDownload {
  readonly fetch: (url: string) => Promise<Response>
  readonly asset: CefComponentAsset
  readonly destination: string
  readonly onProgress: (progress: CefDownloadProgress) => void
}

async function request(fetch: CefArchiveDownload['fetch'], url: string) {
  let response: Response
  try {
    response = await fetch(url)
  } catch (error) {
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

async function nextChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    return await reader.read()
  } catch (error) {
    throw new CefComponentError('offline', 'The download was interrupted.', { cause: error })
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
  const { asset } = download
  const reader = await request(download.fetch, asset.url)
  const hash = createHash('sha256')
  const step = Math.max(1, Math.floor(asset.size / PROGRESS_REPORTS))
  const file = await fs.open(download.destination, 'wx')
  let receivedBytes = 0
  let reportedBytes = 0
  download.onProgress({ receivedBytes, totalBytes: asset.size })
  try {
    while (true) {
      const { done, value } = await nextChunk(reader)
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
