import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useEffect, useRef } from 'react'

const COMPOSER_MAX_HEIGHT_PX = 300

function adjustHeight(element: HTMLElement): void {
  element.style.height = 'auto'
  const scrollHeight = element.scrollHeight
  if (scrollHeight > COMPOSER_MAX_HEIGHT_PX) {
    element.style.height = `${String(COMPOSER_MAX_HEIGHT_PX)}px`
    element.style.overflowY = 'auto'
  } else {
    element.style.height = `${String(scrollHeight)}px`
    element.style.overflowY = 'hidden'
  }
}

/**
 * Auto-resizes the Lexical ContentEditable container based on content height.
 * Caps at COMPOSER_MAX_HEIGHT_PX and adds overflow-y-auto when exceeded.
 */
export function AutoResizePlugin(): null {
  const [editor] = useLexicalComposerContext()
  const rootRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const rootElement = editor.getRootElement()
    if (!rootElement) return
    rootRef.current = rootElement

    const observer = new ResizeObserver(() => adjustHeight(rootElement))
    observer.observe(rootElement)
    return () => observer.disconnect()
  }, [editor])

  useEffect(() => {
    return editor.registerUpdateListener(() => {
      if (rootRef.current) adjustHeight(rootRef.current)
    })
  }, [editor])

  return null
}
