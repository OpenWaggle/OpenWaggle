export function throwIfBrowserPreviewAutomationAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Browser preview action was cancelled.')
}

export function browserPreviewAutomationDelay(milliseconds: number, signal?: AbortSignal) {
  throwIfBrowserPreviewAutomationAborted(signal)
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(finish, milliseconds)
    const abort = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error('Browser preview action was cancelled.'),
      )
    }
    function finish() {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}
