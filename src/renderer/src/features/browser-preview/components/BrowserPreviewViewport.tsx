import type {
  BrowserPreviewControlState,
  BrowserPreviewFixedViewport,
} from '@shared/types/browser-preview-controls'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import type { BrowserPreviewTab } from '../browser-preview-model'
import { useBrowserPreviewViewportResize } from '../hooks/useBrowserPreviewViewportResize'
import { BrowserPreviewViewportResizeHandles } from './BrowserPreviewViewportResizeHandles'

interface BrowserPreviewViewportProps {
  readonly aspectRatio?: number | null
  readonly onRetry: () => void
  readonly onViewportChange?: (viewport: BrowserPreviewFixedViewport) => Promise<void>
  readonly controls: BrowserPreviewControlState
  readonly tab: BrowserPreviewTab
  readonly viewportRef: React.RefObject<HTMLDivElement | null>
}

export function BrowserPreviewViewport({
  aspectRatio = null,
  controls,
  onRetry,
  onViewportChange,
  tab,
  viewportRef,
}: BrowserPreviewViewportProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 })
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const update = () => {
      const bounds = canvas.getBoundingClientRect()
      setCanvasSize((current) =>
        current.width === bounds.width && current.height === bounds.height
          ? current
          : { width: bounds.width, height: bounds.height },
      )
    }
    const observer = new ResizeObserver(update)
    observer.observe(canvas)
    update()
    return () => observer.disconnect()
  }, [])
  const resizeEnabled = controls.viewport.mode === 'fixed' && onViewportChange !== undefined
  const resize = useBrowserPreviewViewportResize({
    aspectRatio,
    containerSize: canvasSize,
    enabled: resizeEnabled,
    previewId: tab.id,
    viewport: controls.viewport,
    zoomFactor: controls.zoomFactor,
    onCommit: async (viewport) => {
      await onViewportChange?.(viewport)
    },
  })
  return (
    <div ref={canvasRef} className="relative min-h-0 flex-1 overflow-hidden bg-bg-secondary/40">
      <div
        ref={viewportRef}
        className="absolute bg-bg ring-1 ring-border/70 shadow-sm"
        data-browser-preview-viewport
        data-viewport-mode={controls.viewport.mode}
        data-viewport-width={
          resize.effectiveViewport.mode === 'fixed' ? resize.effectiveViewport.width : undefined
        }
        data-viewport-height={
          resize.effectiveViewport.mode === 'fixed' ? resize.effectiveViewport.height : undefined
        }
        style={{
          left: resize.layout.x,
          top: resize.layout.y,
          width: resize.layout.width,
          height: resize.layout.height,
        }}
      />
      {resizeEnabled ? (
        <BrowserPreviewViewportResizeHandles
          activeDirection={resize.activeDirection}
          handlers={{
            onKeyDown: resize.handleResizeKeyDown,
            onPointerDown: resize.handleResizePointerDown,
          }}
          layout={resize.layout}
        />
      ) : null}
      {tab.loading && (
        <div className="pointer-events-none absolute top-2 right-2 z-10 rounded bg-bg/80 p-1 text-text-tertiary">
          <Loader2 className="size-3.5 animate-spin" />
        </div>
      )}
      {tab.error !== null && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
          <p className="text-sm font-medium text-text-primary">Page could not load</p>
          <p className="max-w-md text-xs text-text-tertiary">{tab.error}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Retry
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void api.openExternal(tab.url)}>
              Open in browser
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
