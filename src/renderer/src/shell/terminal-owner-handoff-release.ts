const OWNER_HANDOFF_FALLBACK_MS = 1_000

/** Retain old-pane event routing across the destination's React commits, even
 * when persistence failed after native ownership irreversibly changed. */
export function releaseOwnerHandoffAfterCommit(release: () => void) {
  if (typeof requestAnimationFrame !== 'function') {
    queueMicrotask(release)
    return
  }
  let released = false
  const releaseOnce = () => {
    if (released) return
    released = true
    clearTimeout(fallback)
    release()
  }
  // Hidden windows may throttle animation frames indefinitely.
  const fallback = setTimeout(releaseOnce, OWNER_HANDOFF_FALLBACK_MS)
  requestAnimationFrame(() => requestAnimationFrame(releaseOnce))
}
