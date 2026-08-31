import { useEffect, useRef, useState } from 'react'

/** Keep loading feedback visible until Pierre emits the first rendered code node. */
export function useDiffCodeViewReady() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const markReady = () => {
      if (root.querySelector('code') === null) return false
      setReady(true)
      return true
    }
    if (markReady()) return
    const observer = new MutationObserver(() => {
      if (markReady()) observer.disconnect()
    })
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  return { rootRef, ready }
}
