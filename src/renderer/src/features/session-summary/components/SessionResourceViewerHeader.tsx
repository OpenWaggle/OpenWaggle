import { isMatching, P } from '@diegogbrisa/ts-match'
import type { SessionResource } from '@shared/types/session-resource'
import { Download, ExternalLink, FolderSearch, X } from 'lucide-react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import type { ImageViewerZoom } from './SessionResourceViewerCanvas'

const LOCAL_RESOURCE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/u

function provenance(resource: SessionResource) {
  const role =
    resource.isSource && resource.isOutput
      ? 'Source and output'
      : resource.isOutput
        ? 'Output'
        : 'Source'
  const occurrence = resource.occurrences.at(-1)
  if (!occurrence) return role
  const branch = occurrence.branchId ? ` · branch ${occurrence.branchId}` : ''
  return `${role} · ${occurrence.actor} ${occurrence.activity}${branch}`
}

function download(resource: SessionResource, url: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = resource.title
  anchor.click()
}

function ResourceActions({
  resource,
  source,
}: {
  readonly resource: SessionResource
  readonly source: string | null
}) {
  const originalPath =
    resource.locator && LOCAL_RESOURCE_PATH.test(resource.locator) ? resource.locator : null
  return (
    <div className="flex items-center gap-1">
      {source ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Download image"
          onClick={() => download(resource, source)}
        >
          <Download className="size-4" />
        </Button>
      ) : null}
      {originalPath ? (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Open original ${resource.title}`}
            onClick={() => void api.openPath(originalPath)}
          >
            <ExternalLink className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Reveal original ${resource.title}`}
            onClick={() => void api.revealPath(originalPath)}
          >
            <FolderSearch className="size-4" />
          </Button>
        </>
      ) : !source && resource.locator?.startsWith('http') ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open image source"
          onClick={() => void api.openExternal(resource.locator ?? '')}
        >
          <ExternalLink className="size-4" />
        </Button>
      ) : null}
    </div>
  )
}

export function SessionResourceViewerHeader({
  resource,
  index,
  count,
  zoom,
  source,
  onZoomChange,
  onClose,
}: {
  readonly resource: SessionResource
  readonly index: number
  readonly count: number
  readonly zoom: ImageViewerZoom
  readonly source: string | null
  readonly onZoomChange: (zoom: ImageViewerZoom) => void
  readonly onClose: () => void
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text-primary">{resource.title}</p>
        <p className="text-xs text-text-tertiary">
          <span>
            {index + 1} of {count}
          </span>{' '}
          · {provenance(resource)}
        </p>
      </div>
      <Select
        aria-label="Image zoom"
        selectSize="xs"
        value={zoom}
        onChange={(event) => {
          if (isMatching(P.union('fit', '25', '50', '100', '150', '200'), event.target.value))
            onZoomChange(event.target.value)
        }}
      >
        <option value="fit">Fit</option>
        <option value="25">25%</option>
        <option value="50">50%</option>
        <option value="100">100%</option>
        <option value="150">150%</option>
        <option value="200">200%</option>
      </Select>
      <ResourceActions resource={resource} source={source} />
      <Button variant="ghost" size="icon-sm" aria-label="Close image viewer" onClick={onClose}>
        <X className="size-4" />
      </Button>
    </header>
  )
}
