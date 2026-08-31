import { useEffect, useRef, useState } from 'react'

function hasRenderedCode(root: HTMLElement) {
  if (root.querySelector('code') !== null) return true
  return [...root.querySelectorAll('diffs-container')].some(
    (container) => container.shadowRoot?.querySelector('code') !== null,
  )
}

function watchForRenderedCode(root: HTMLElement, onReady: () => void) {
  const observedShadowRoots = new WeakSet<Node>()
  const disconnect = () => {
    rootObserver.disconnect()
    shadowObserver.disconnect()
  }
  const scan = () => {
    if (hasRenderedCode(root)) {
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

/** Keep loading feedback visible until Pierre emits the first rendered code node. */
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
