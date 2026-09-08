import { type RefObject, useEffect, useRef, useState } from 'react'
import {
  observeTerminalSelectionActions,
  resolveTerminalSelectionActionPosition,
  type TerminalSelectionPoint,
} from '../lib/terminal-selection-actions'

const DEFAULT_TOOLBAR_SIZE = { width: 148, height: 30 }

interface TerminalSelectionToolbarOptions {
  readonly surfaceRef: RefObject<HTMLDivElement | null>
  readonly toolbarRef: RefObject<HTMLDivElement | null>
  readonly selectionText: string
  readonly getSelectionEndRect: () => { readonly right: number; readonly bottom: number } | null
}

export function useTerminalSelectionToolbar(options: TerminalSelectionToolbarOptions) {
  const [position, setPosition] = useState<TerminalSelectionPoint | null>(null)
  const observerRef = useRef<ReturnType<typeof observeTerminalSelectionActions> | null>(null)
  const selectionTextRef = useRef(options.selectionText)
  const getSelectionEndRectRef = useRef(options.getSelectionEndRect)
  selectionTextRef.current = options.selectionText
  getSelectionEndRectRef.current = options.getSelectionEndRect

  useEffect(() => {
    const surface = options.surfaceRef.current
    if (surface === null) return
    const observer = observeTerminalSelectionActions({
      element: surface,
      getActionElement: () => options.toolbarRef.current,
      onSelection: (pointer) => {
        if (selectionTextRef.current.length === 0) return
        const toolbar = options.toolbarRef.current
        const actionSize = toolbar
          ? { width: toolbar.offsetWidth, height: toolbar.offsetHeight }
          : DEFAULT_TOOLBAR_SIZE
        setPosition(
          resolveTerminalSelectionActionPosition({
            bounds: surface.getBoundingClientRect(),
            selectionRect: getSelectionEndRectRef.current(),
            pointer,
            viewport: { width: window.innerWidth, height: window.innerHeight },
            actionSize,
          }),
        )
      },
      onDismiss: () => setPosition(null),
    })
    observerRef.current = observer
    return () => {
      observer.dispose()
      observerRef.current = null
    }
  }, [options.surfaceRef, options.toolbarRef])

  useEffect(() => {
    if (options.selectionText.length === 0) {
      observerRef.current?.cancel()
      setPosition(null)
      return
    }
    observerRef.current?.selectionChanged()
  }, [options.selectionText])

  return {
    position,
    dismiss: () => observerRef.current?.dismiss(),
  }
}
