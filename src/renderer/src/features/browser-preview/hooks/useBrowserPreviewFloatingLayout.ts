import type { BrowserPreviewBounds } from '@shared/types/browser-preview'
import type { CSSProperties } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { fitBrowserPreviewFloatingFrame } from '../lib/browser-preview-floating-layout'
import { browserPreviewBounds, pageHasOccludingDialog } from '../lib/browser-preview-native-bounds'
import type {
  BrowserPreviewFloatingPosition,
  BrowserPreviewFloatingSize,
} from '../state/browser-preview-floating-store'
import { useBrowserPreviewFloatingInteractions } from './useBrowserPreviewFloatingInteractions'

interface BrowserPreviewFloatingLayoutOptions {
  readonly ownerKey: string
  readonly previewId: string
  readonly position: BrowserPreviewFloatingPosition | null
  readonly size: BrowserPreviewFloatingSize | null
  readonly sourceSize: BrowserPreviewFloatingSize
  readonly sourceViewport?: BrowserPreviewBounds['sourceViewport']
  readonly visible: boolean
  readonly nativeReady: boolean
}

export function useBrowserPreviewFloatingLayout(options: BrowserPreviewFloatingLayoutOptions) {
  const rootRef = useRef<HTMLElement>(null)
  const [container, setContainer] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
  const frame = fitBrowserPreviewFloatingFrame(
    options.size,
    options.position,
    container,
    options.sourceSize,
  )

  useLayoutEffect(() => {
    const parent = rootRef.current?.offsetParent
    if (!(parent instanceof HTMLElement)) return
    const measure = () =>
      setContainer((current) =>
        current.width === parent.clientWidth && current.height === parent.clientHeight
          ? current
          : { width: parent.clientWidth, height: parent.clientHeight },
      )
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  // ResizeObserver sees size changes, but moving an absolute element needs a bounds update too.
  useLayoutEffect(() => {
    if (!options.nativeReady) return
    const scheduled = requestAnimationFrame(() => {
      const viewport = rootRef.current?.querySelector<HTMLElement>(
        '[data-browser-preview-viewport]',
      )
      if (!viewport) return
      const visible =
        options.visible &&
        document.visibilityState === 'visible' &&
        !pageHasOccludingDialog(options.ownerKey)
      void api
        .setBrowserPreviewBounds(
          options.previewId,
          visible ? browserPreviewBounds(viewport, options.sourceViewport) : null,
        )
        .catch(() => undefined)
    })
    return () => cancelAnimationFrame(scheduled)
  })

  const interactions = useBrowserPreviewFloatingInteractions({
    ownerKey: options.ownerKey,
    previewId: options.previewId,
    frame,
    container,
    sourceSize: options.sourceSize,
  })
  const style: CSSProperties = {
    left: frame.x,
    top: frame.y,
    width: frame.width,
    height: frame.height,
  }
  return { rootRef, style, ...interactions }
}
