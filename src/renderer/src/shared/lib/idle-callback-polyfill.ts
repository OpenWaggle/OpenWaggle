/**
 * `requestIdleCallback` for the system webview of the Electrobun shell (ADR 0064): WebKit (macOS
 * and Linux) ships without it, Chromium and WebView2 have it. Code that schedules idle work checks
 * for it and falls back to a timer; this gives libraries that call it unguarded the same fallback:
 * the callback runs on the next task with a short frame budget.
 */
const IDLE_FRAME_BUDGET_MS = 50

export function installIdleCallbackPolyfill(target: Window) {
  if (typeof target.requestIdleCallback === 'function') return false
  target.requestIdleCallback = (callback) => {
    const start = performance.now()
    return target.setTimeout(() =>
      callback({
        didTimeout: false,
        timeRemaining: () => Math.max(0, IDLE_FRAME_BUDGET_MS - (performance.now() - start)),
      }),
    )
  }
  target.cancelIdleCallback = (handle) => target.clearTimeout(handle)
  return true
}

if (typeof window !== 'undefined') installIdleCallbackPolyfill(window)
