import { useEffect, useRef, useState } from 'react'

/**
 * An inline confirmation that replaces its trigger. Focus moves to the safe choice when it opens,
 * and returns to the trigger when the user backs out, so keyboard users never lose their place.
 */
export function useInlineConfirm() {
  const [confirming, setConfirming] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const safeChoiceRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)
  useEffect(() => {
    if (confirming) {
      safeChoiceRef.current?.focus()
      return
    }
    if (!returnFocus.current) return
    returnFocus.current = false
    triggerRef.current?.focus()
  }, [confirming])
  return {
    confirming,
    triggerRef,
    safeChoiceRef,
    ask: () => setConfirming(true),
    backOut: () => {
      returnFocus.current = true
      setConfirming(false)
    },
  }
}
