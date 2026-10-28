/**
 * Background work the renderer can put off until the browser is idle, so it never competes with
 * the commit and paint of what the user just opened (v1 performance, session open).
 */

/** Longest a task waits for an idle period before it runs anyway. */
export const IDLE_TASK_TIMEOUT_MS = 2_000

/** Resolves in the next idle period, or after `timeoutMs` when the renderer never goes idle. */
export function whenRendererIdle(timeoutMs = IDLE_TASK_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: timeoutMs })
      return
    }
    setTimeout(resolve, 0)
  })
}
