import type { SessionResource } from '@shared/types/session-resource'
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'

export type ImageViewerZoom = 'fit' | '25' | '50' | '100' | '150' | '200'

const PERCENT_DENOMINATOR = 100
const IMAGE_VIEWER_ZOOM_STEPS: readonly Exclude<ImageViewerZoom, 'fit'>[] = [
  '25',
  '50',
  '100',
  '150',
  '200',
]

export function stepImageViewerZoom(
  zoom: ImageViewerZoom,
  direction: 'in' | 'out',
): ImageViewerZoom {
  if (zoom === 'fit') return direction === 'in' ? '100' : 'fit'
  const index = IMAGE_VIEWER_ZOOM_STEPS.indexOf(zoom)
  const offset = direction === 'in' ? 1 : -1
  return (
    IMAGE_VIEWER_ZOOM_STEPS[
      Math.max(0, Math.min(IMAGE_VIEWER_ZOOM_STEPS.length - 1, index + offset))
    ] ?? zoom
  )
}

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

function useCanvasDrag(pannable: boolean, canvasRef: RefObject<HTMLElement | null>) {
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
  return { dragging, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
}

function useCanvasPinchZoom(
  canvasRef: RefObject<HTMLElement | null>,
  zoom: ImageViewerZoom,
  onZoomChange: (zoom: ImageViewerZoom) => void,
) {
  const handleWheel = useEffectEvent((event: WheelEvent) => {
    // Chromium exposes trackpad pinch as a modifier-wheel gesture in Electron.
    if ((!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return
    event.preventDefault()
    onZoomChange(stepImageViewerZoom(zoom, event.deltaY < 0 ? 'in' : 'out'))
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // React delegates wheel events through passive listeners, which cannot cancel
    // Chromium's own zoom/scroll action. Only the image canvas needs this listener.
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [canvasRef])
}

export function SessionResourceViewerCanvas({
  resource,
  source,
  zoom,
  canvasRef,
  onZoomChange,
  onImageError,
}: {
  readonly resource: SessionResource
  readonly source: string | null
  readonly zoom: ImageViewerZoom
  readonly canvasRef: RefObject<HTMLElement | null>
  readonly onZoomChange: (zoom: ImageViewerZoom) => void
  readonly onImageError: () => void
}) {
  const showToast = useUIStore((state) => state.showToast)
  const [intrinsicSize, setIntrinsicSize] = useState<{
    readonly resourceId: string
    readonly width: number
    readonly height: number
  } | null>(null)
  const imageSize = intrinsicSize?.resourceId === resource.id ? intrinsicSize : null
  const pannable = source !== null && zoom !== 'fit'
  const drag = useCanvasDrag(pannable, canvasRef)
  useCanvasPinchZoom(canvasRef, zoom, onZoomChange)

  return (
    <section
      ref={canvasRef}
      aria-label="Image canvas"
      className={`relative min-h-0 flex-1 overflow-auto bg-bg-tertiary p-8 ${
        pannable ? (drag.dragging ? 'cursor-grabbing' : 'cursor-grab') : ''
      }`}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerCancel}
    >
      {source ? (
        <div
          className={
            zoom === 'fit'
              ? 'flex h-full w-full items-center justify-center'
              : 'grid h-max min-h-full w-max min-w-full place-items-center'
          }
        >
          <img
            alt={resource.title}
            src={source}
            draggable={false}
            onError={onImageError}
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
      ) : (
        <div className="rounded-lg border border-border bg-bg-secondary p-6 text-center">
          <p className="text-sm text-text-secondary">This image is available at its source.</p>
          {resource.locator?.startsWith('http') ? (
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => {
                void api.openExternal(resource.locator ?? '').catch((cause: unknown) => {
                  showToast(
                    cause instanceof Error ? cause.message : 'Could not open the image source.',
                    'error',
                  )
                })
              }}
            >
              Open source
            </Button>
          ) : null}
        </div>
      )}
    </section>
  )
}
