import { useEffect, useLayoutEffect, useRef } from 'react'

interface FocusHandoffOptions<Container extends HTMLElement> {
  /** Selector for the element that takes focus inside the container after its content changes. */
  readonly target: string
  /** Where focus goes when nothing in the container matches, such as the region heading. */
  readonly fallback?: (container: Container) => HTMLElement | null
}

/**
 * Keeps keyboard focus from dropping to the page body when a re-render replaces the focused
 * element inside a container, for example a notice that disappears once its fix lands. Focus
 * moves to `target`, or `fallback`, only if it was inside the container and is now nowhere; a user
 * who moved focus elsewhere keeps it there.
 */
export function useFocusHandoff<Container extends HTMLElement>(
  options: FocusHandoffOptions<Container>,
) {
  const ref = useRef<Container>(null)
  const focusedWithin = useRef(false)

  useEffect(() => {
    const container = ref.current
    if (container === null) return
    const onFocusIn = () => {
      focusedWithin.current = true
    }
    const onFocusOut = (event: FocusEvent) => {
      const left = event.target
      // A focused node removed by a re-render may blur on its way out; that is a hand-off, not
      // the user leaving, so only a blur from a node still in the page clears the flag.
      queueMicrotask(() => {
        const stillThere = left instanceof Node && left.isConnected
        if (stillThere && !container.contains(document.activeElement)) {
          focusedWithin.current = false
        }
      })
    }
    container.addEventListener('focusin', onFocusIn)
    container.addEventListener('focusout', onFocusOut)
    return () => {
      container.removeEventListener('focusin', onFocusIn)
      container.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  useLayoutEffect(() => {
    const container = ref.current
    if (container === null || !focusedWithin.current) return
    const active = document.activeElement
    if (active !== null && active !== document.body) {
      if (!container.contains(active)) focusedWithin.current = false
      return
    }
    const next =
      container.querySelector<HTMLElement>(options.target) ?? options.fallback?.(container) ?? null
    next?.focus()
    focusedWithin.current = next !== null && container.contains(next)
  })

  return ref
}
