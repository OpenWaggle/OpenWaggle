import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useEffect, useRef } from 'react'

const COMPOSER_MAX_HEIGHT_PX = 300

function getAutoResizeBaseCssText(element: HTMLElement) {
  return element.style.cssText
    .replaceAll(/(?:^|;)\s*(?:height|overflow-y)\s*:[^;]*/g, '')
    .replace(/^;+|;+$/g, '')
}

function adjustHeight(element: HTMLElement) {
  const baseCssText = getAutoResizeBaseCssText(element)
  element.style.cssText = `${baseCssText};height:auto;`
  const scrollHeight = element.scrollHeight
  const capped = scrollHeight > COMPOSER_MAX_HEIGHT_PX
  const height = capped ? COMPOSER_MAX_HEIGHT_PX : scrollHeight
  const overflowY = capped ? 'auto' : 'hidden'
  element.style.cssText = `${baseCssText};height:${String(height)}px;overflow-y:${overflowY};`
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
