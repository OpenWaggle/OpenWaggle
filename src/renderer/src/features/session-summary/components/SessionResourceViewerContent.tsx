import type { SessionResource } from '@shared/types/session-resource'
import type { RefObject } from 'react'
import { Button } from '@/shared/ui/Button'
import { type ImageViewerZoom, SessionResourceViewerCanvas } from './SessionResourceViewerCanvas'

interface SessionResourceViewerContentProps {
  readonly resource: SessionResource
  readonly zoom: ImageViewerZoom
  readonly canvasRef: RefObject<HTMLElement | null>
  readonly onZoomChange: (zoom: ImageViewerZoom) => void
  readonly model: {
    readonly source: string | null
    readonly loading: boolean
    readonly failed: boolean
    readonly errorMessage: string | null
    readonly retryError: string | null
    readonly retrying: boolean
    readonly retry: () => Promise<void>
    readonly onImageError: () => void
  }
}

export function SessionResourceViewerContent({
  resource,
  zoom,
  canvasRef,
  onZoomChange,
  model,
}: SessionResourceViewerContentProps) {
  if (model.loading) {
    return (
      <output className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-text-secondary">
        Loading image…
      </output>
    )
  }
  if (model.failed) {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
        role="alert"
      >
        <p className="text-sm font-medium text-text-primary">Couldn’t load this image.</p>
        {model.errorMessage ? (
          <p className="text-xs text-text-tertiary">{model.errorMessage}</p>
        ) : null}
        {model.retryError ? <p className="text-sm text-error">{model.retryError}</p> : null}
        <Button
          variant="secondary"
          aria-disabled={model.retrying}
          onClick={() => {
            if (!model.retrying) void model.retry()
          }}
        >
          {model.retrying ? 'Retrying image…' : 'Retry image'}
        </Button>
      </div>
    )
  }
  return (
    <SessionResourceViewerCanvas
      resource={resource}
      source={model.source}
      zoom={zoom}
      canvasRef={canvasRef}
      onZoomChange={onZoomChange}
      onImageError={model.onImageError}
    />
  )
}
