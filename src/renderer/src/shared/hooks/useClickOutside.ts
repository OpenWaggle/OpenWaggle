import type { RefObject } from 'react'
import { useEffect, useEffectEvent } from 'react'

/**
 * Calls `onClose` when a mousedown occurs outside the referenced element.
 * No-ops when the ref is null or the element is not mounted.
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  enabled = true,
): void {
  const close = useEffectEvent(onClose)

  useEffect(() => {
    if (!enabled) return

    function onMouseDown(event: MouseEvent) {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) {
        close()
      }
    }

    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [ref, enabled])
}
