import type { WebContents } from 'electron'

const NATIVE_CLOSE_TIMEOUT_MS = 5_000

/** A successful close call is not evidence that Chromium destroyed the contents. */
export function closeBrowserPreviewContents(contents: WebContents): Promise<void> {
  return new Promise((resolve, reject) => {
    if (contents.isDestroyed()) {
      resolve()
      return
    }
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      try {
        contents.removeListener('destroyed', onDestroyed)
      } catch {
        // Listener removal races do not change the exact contents' destruction proof.
      }
      if (error === undefined) resolve()
      else reject(error)
    }
    const onDestroyed = () => finish()
    const timeout = setTimeout(() => {
      try {
        finish(contents.isDestroyed() ? undefined : new Error('Browser preview did not close.'))
      } catch (error) {
        finish(error)
      }
    }, NATIVE_CLOSE_TIMEOUT_MS)
    try {
      contents.once('destroyed', onDestroyed)
      contents.close()
      if (contents.isDestroyed()) finish()
    } catch (error) {
      finish(error)
    }
  })
}
