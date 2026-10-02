import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from 'react'

/**
 * Returns focus to a picker's trigger when the picker becomes `disabled` while its open list holds
 * focus: the list closes, which would otherwise drop focus on the page. The trigger stays
 * focusable while disabled (`aria-disabled`) and explains why. Call the returned `forget` whenever the list
 * closes for another reason, so a later lock does not move focus the user put elsewhere.
 */
export function useListFocusReturn(input: {
  readonly disabled: boolean
  readonly rootRef: RefObject<HTMLElement | null>
  readonly listRef: RefObject<HTMLElement | null>
  readonly triggerRef: RefObject<HTMLElement | null>
}) {
  const { disabled, rootRef, listRef, triggerRef } = input
  const focusInListRef = useRef(false)

  // A list removed while focused fires no reliable focusout, so the last focusin decides.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    function onFocusIn(event: FocusEvent) {
      focusInListRef.current =
        event.target instanceof Node && listRef.current?.contains(event.target) === true
    }
    function onFocusOut(event: FocusEvent) {
      const next = event.relatedTarget
      if (next instanceof Node && !listRef.current?.contains(next)) focusInListRef.current = false
    }
    root.addEventListener('focusin', onFocusIn)
    root.addEventListener('focusout', onFocusOut)
    return () => {
      root.removeEventListener('focusin', onFocusIn)
      root.removeEventListener('focusout', onFocusOut)
    }
  }, [rootRef, listRef])

  useLayoutEffect(() => {
    if (!disabled || !focusInListRef.current) return
    focusInListRef.current = false
    const active = document.activeElement
    if (active === null || active === document.body) triggerRef.current?.focus()
  }, [disabled, triggerRef])

  // Stable, so an effect that closes the list can call it without re-subscribing.
  return useCallback(() => {
    focusInListRef.current = false
  }, [])
}
