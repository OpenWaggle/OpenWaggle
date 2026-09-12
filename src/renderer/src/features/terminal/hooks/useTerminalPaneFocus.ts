import { type RefObject, useEffect, useRef } from 'react'

interface TerminalPaneFocusOptions {
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly paneRef: RefObject<HTMLDivElement | null>
  readonly focused: boolean
  readonly focus: () => void
  readonly onFocus: () => void
}

/** Keeps native pane interaction and renderer focus state in sync. */
export function useTerminalPaneFocus(options: TerminalPaneFocusOptions) {
  const focusRef = useRef(options.focus)
  const onFocusRef = useRef(options.onFocus)

  useEffect(() => {
    focusRef.current = options.focus
    onFocusRef.current = options.onFocus
  })

  useEffect(() => {
    const pane = options.paneRef.current
    if (pane === null) return

    const handleMouseDown = () => {
      onFocusRef.current()
      focusRef.current()
    }
    pane.addEventListener('mousedown', handleMouseDown)
    return () => pane.removeEventListener('mousedown', handleMouseDown)
  }, [options.paneRef])

  useEffect(() => {
    if (!options.focused) return
    const frame = requestAnimationFrame(() => {
      const helper = options.containerRef.current?.querySelector('textarea.xterm-helper-textarea')
      if (helper instanceof HTMLTextAreaElement) {
        helper.focus()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [options.containerRef, options.focused])
}
