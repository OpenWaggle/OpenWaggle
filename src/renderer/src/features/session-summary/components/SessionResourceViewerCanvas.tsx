import type { SessionResource } from '@shared/types/session-resource'
import { ChevronLeft, ChevronRight, CircleAlert, LoaderCircle } from 'lucide-react'
import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'

export type ImageViewerZoom = 'fit' | '25' | '50' | '100' | '150' | '200'

export interface ImageViewerNavigation {
  readonly index: number
  readonly count: number
  readonly onNavigate: (index: number) => void
}

const PERCENT_DENOMINATOR = 100

function imageStyle(
  zoom: ImageViewerZoom,
  intrinsicSize: { readonly width: number; readonly height: number } | null,
) {
  return zoom === 'fit'
    ? { maxHeight: '100%', maxWidth: '100%' }
    : {
        width: intrinsicSize
          ? `${intrinsicSize.width * (Number(zoom) / PERCENT_DENOMINATOR)}px`
          : 'auto',
        height: intrinsicSize
          ? `${intrinsicSize.height * (Number(zoom) / PERCENT_DENOMINATOR)}px`
          : 'auto',
        maxWidth: 'none',
        maxHeight: 'none',
      }
}

function useCanvasDrag(pannable: boolean) {
  const canvasRef = useRef<HTMLElement>(null)
  const dragRef = useRef<{
    readonly pointerId: number
    readonly clientX: number
    readonly clientY: number
    readonly scrollLeft: number
    readonly scrollTop: number
  } | null>(null)
  const [dragging, setDragging] = useState(false)
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const canvas = canvasRef.current
    const target = event.target
    if (!pannable || !canvas || (target instanceof Element && target.closest('button'))) return
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: canvas.scrollLeft,
      scrollTop: canvas.scrollTop,
    }
    canvas.setPointerCapture?.(event.pointerId)
    setDragging(true)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const canvas = canvasRef.current
    const drag = dragRef.current
    if (!canvas || !drag || drag.pointerId !== event.pointerId) return
    canvas.scrollLeft = drag.scrollLeft - (event.clientX - drag.clientX)
    canvas.scrollTop = drag.scrollTop - (event.clientY - drag.clientY)
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    canvasRef.current?.releasePointerCapture?.(event.pointerId)
    dragRef.current = null
    setDragging(false)
  }
  const onPointerCancel = () => {
    dragRef.current = null
    setDragging(false)
  }
  return { canvasRef, dragging, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
}

export function SessionResourceViewerCanvas({
  resource,
  source,
  loading,
  errorMessage,
  zoom,
  navigation,
  onRetry,
}: {
  readonly resource: SessionResource
  readonly source: string | null
  readonly loading: boolean
  readonly errorMessage: string | null
  readonly zoom: ImageViewerZoom
  readonly navigation: ImageViewerNavigation
  readonly onRetry: () => void
}) {
  const [intrinsicSize, setIntrinsicSize] = useState<{
    readonly resourceId: string
    readonly width: number
    readonly height: number
  } | null>(null)
  const imageSize = intrinsicSize?.resourceId === resource.id ? intrinsicSize : null
  const pannable = source !== null && zoom !== 'fit'
  const drag = useCanvasDrag(pannable)

  return (
    <section
      ref={drag.canvasRef}
      aria-label="Image canvas"
      className={`relative min-h-0 flex-1 overflow-auto bg-bg-tertiary p-8 ${
        pannable ? (drag.dragging ? 'cursor-grabbing' : 'cursor-grab') : ''
      }`}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerCancel}
    >
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label="Previous image"
        disabled={navigation.index <= 0}
        className="fixed left-5 top-1/2 z-10"
        onClick={() => navigation.onNavigate(navigation.index - 1)}
      >
        <ChevronLeft className="size-5" />
      </Button>
      {source ? (
        <div className="flex min-h-full min-w-full items-center justify-center">
          <img
            alt={resource.title}
            src={source}
            draggable={false}
            style={imageStyle(zoom, imageSize)}
            className="shrink-0 object-contain shadow-2xl"
            onLoad={(event) => {
              setIntrinsicSize({
                resourceId: resource.id,
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }}
          />
        </div>
      ) : loading ? (
        <div role="status" className="flex min-h-full items-center justify-center gap-2">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          <span className="text-sm text-text-tertiary">Loading full-size image…</span>
        </div>
      ) : errorMessage ? (
        <div
          role="alert"
          className="mx-auto max-w-sm rounded-lg border border-border bg-bg-secondary p-6 text-center"
        >
          <CircleAlert className="mx-auto mb-3 size-5 text-warning" aria-hidden="true" />
          <p className="text-sm font-medium text-text-primary">Couldn’t load this image.</p>
          <p className="mt-1 text-xs text-text-tertiary">{errorMessage}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            aria-label="Retry loading image"
            onClick={onRetry}
          >
            Retry
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-bg-secondary p-6 text-center">
          <p className="text-sm text-text-secondary">This image is available at its source.</p>
          {resource.locator?.startsWith('http') ? (
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => void api.openExternal(resource.locator ?? '')}
            >
              Open source
            </Button>
          ) : null}
        </div>
      )}
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label="Next image"
        disabled={navigation.index >= navigation.count - 1}
        className="fixed right-5 top-1/2 z-10"
        onClick={() => navigation.onNavigate(navigation.index + 1)}
      >
        <ChevronRight className="size-5" />
      </Button>
    </section>
  )
}
