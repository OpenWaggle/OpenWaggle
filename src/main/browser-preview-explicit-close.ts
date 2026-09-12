import type { BrowserPreviewRecord } from './browser-preview-records'

const CLOSE_TIMEOUT_MS = 2_000
const requested = new WeakSet<BrowserPreviewRecord>()
const pending = new WeakMap<BrowserPreviewRecord, Promise<void>>()

export function hasRequestedBrowserPreviewClose(record: BrowserPreviewRecord): boolean {
  return requested.has(record)
}

export function isBrowserPreviewClosePending(record: BrowserPreviewRecord): boolean {
  return pending.has(record)
}

/** Keep native ownership until Electron confirms destruction, including across retries. */
export function closeBrowserPreviewRecord(
  record: BrowserPreviewRecord | undefined,
  onDestroyed: (record: BrowserPreviewRecord) => void,
): Promise<void> {
  if (!record) return Promise.resolve()
  const existing = pending.get(record)
  if (existing) return existing
  const completion = Promise.withResolvers<void>()
  requested.add(record)
  pending.set(record, completion.promise)
  const contents = record.view.webContents
  let finished = false
  const cleanup = () => {
    finished = true
    clearTimeout(timeout)
    pending.delete(record)
    try {
      contents.removeListener('destroyed', destroyed)
    } catch {
      // Electron teardown can invalidate its emitter wrapper; completion must still settle.
    }
  }
  const destroyed = () => {
    if (finished) return
    cleanup()
    requested.delete(record)
    onDestroyed(record)
    completion.resolve()
  }
  const fail = (error: unknown) => {
    if (finished) return
    cleanup()
    completion.reject(error)
  }
  const timeout = setTimeout(() => {
    fail(new Error('Browser preview native content did not close before the deadline.'))
  }, CLOSE_TIMEOUT_MS)
  try {
    contents.once('destroyed', destroyed)
    if (contents.isDestroyed()) destroyed()
    else {
      contents.close()
      if (contents.isDestroyed()) destroyed()
    }
  } catch (error) {
    // A native wrapper can throw after destruction. The postcondition, not the throw, wins.
    try {
      if (contents.isDestroyed()) destroyed()
      else fail(error)
    } catch {
      fail(error)
    }
  }
  return completion.promise
}
