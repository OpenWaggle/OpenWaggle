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
 *
 * Measuring forces a layout, so it runs only when the height can change: an update that changed
 * the text (not one that only moved the selection), or a change of the editor's width, which
 * rewraps it. The observer also fires for the height set here; measuring again then found the
 * same height and cost a second forced layout on every keystroke.
 */
export function AutoResizePlugin(): null {
  const [editor] = useLexicalComposerContext()
  const rootRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const rootElement = editor.getRootElement()
    if (!rootElement) return
    rootRef.current = rootElement

    let measuredWidth: number | null = null
    const observer = new ResizeObserver((entries) => {
      const width = entries.at(-1)?.contentRect.width ?? null
      if (width !== null && width === measuredWidth) return
      measuredWidth = width
      adjustHeight(rootElement)
    })
    observer.observe(rootElement)
    return () => observer.disconnect()
  }, [editor])

  useEffect(() => {
    return editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return
      if (rootRef.current) adjustHeight(rootRef.current)
    })
  }, [editor])

  return null
}
