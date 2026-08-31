import { useEffect, useRef, useState } from 'react'

const READY_SELECTOR = 'code, [data-diffs-header]'

function hasRenderedDiff(root: HTMLElement) {
  if (root.querySelector(READY_SELECTOR) !== null) return true
  return [...root.querySelectorAll('diffs-container')].some(
    (container) => container.shadowRoot?.querySelector(READY_SELECTOR) !== null,
  )
}

function watchForRenderedCode(root: HTMLElement, onReady: () => void) {
  const observedShadowRoots = new WeakSet<Node>()
  const disconnect = () => {
    rootObserver.disconnect()
    shadowObserver.disconnect()
  }
  const scan = () => {
    if (hasRenderedDiff(root)) {
      disconnect()
      onReady()
      return
    }
    for (const container of root.querySelectorAll('diffs-container')) {
      const shadowRoot = container.shadowRoot
      if (!shadowRoot || observedShadowRoots.has(shadowRoot)) continue
      observedShadowRoots.add(shadowRoot)
      shadowObserver.observe(shadowRoot, { childList: true, subtree: true })
    }
  }
  const rootObserver = new MutationObserver(scan)
  const shadowObserver = new MutationObserver(scan)
  rootObserver.observe(root, { childList: true, subtree: true })
  scan()
  return disconnect
}

/** Keep loading feedback visible until Pierre emits its first code row or header-only change. */
export function useDiffCodeViewReady() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    return watchForRenderedCode(root, () => setReady(true))
  }, [])

  return { rootRef, ready }
}
