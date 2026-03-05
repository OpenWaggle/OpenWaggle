const DEFAULT_MAX_WAIT_MS = 10_000
const DEFAULT_POLL_INTERVAL_MS = 50

interface LoadingRef {
  readonly current: boolean
}

interface WaitForNotLoadingOptions {
  readonly maxWaitMs?: number
  readonly pollIntervalMs?: number
}

export function waitForNotLoading(
  isLoadingRef: LoadingRef,
  options: WaitForNotLoadingOptions = {},
): Promise<void> {
  if (!isLoadingRef.current) {
    return Promise.resolve()
  }

  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS

  return new Promise((resolve) => {
    let elapsedMs = 0
    const interval = setInterval(() => {
      elapsedMs += pollIntervalMs
      if (!isLoadingRef.current || elapsedMs >= maxWaitMs) {
        clearInterval(interval)
        resolve()
      }
    }, pollIntervalMs)
  })
}
