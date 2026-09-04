import { isMatching, P } from '@diegogbrisa/ts-match'
import type { SessionResource } from '@shared/types/session-resource'
import {
  CircleAlert,
  Download,
  ExternalLink,
  FolderOpen,
  FolderSearch,
  LoaderCircle,
  X,
} from 'lucide-react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import { Select } from '@/shared/ui/Select'
import { resourceBranchLabel, resourceProvenanceLabel } from '../model/session-resource-browser'
import type { ImageViewerZoom as Zoom } from './SessionResourceViewerCanvas'

const LOCAL_RESOURCE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/u

export const VIEWER_DIALOG_CLASS =
  'size-full max-h-none max-w-none overflow-hidden rounded-none border-0 bg-bg p-0'

function downloadResource(resource: SessionResource, url: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = resource.title
  anchor.click()
}

function resourceCategoryLabel(resource: SessionResource) {
  if (resource.isSource && resource.isOutput) return 'Source and output'
  return resource.isOutput ? 'Output' : 'Source'
}

function viewerProvenance(resource: SessionResource) {
  const occurrence = resource.occurrences.reduce<(typeof resource.occurrences)[number] | null>(
    (latest, candidate) =>
      latest === null || candidate.createdAt > latest.createdAt ? candidate : latest,
    null,
  )
  if (!occurrence) return resourceCategoryLabel(resource)
  const parts = [
    resourceCategoryLabel(resource),
    resourceProvenanceLabel(occurrence.activity, occurrence.actor, occurrence.label),
  ]
  if (occurrence.branchId) parts.push(`Branch ${resourceBranchLabel(occurrence.branchId)}`)
  return parts.join(' · ')
}

function ViewerResourceActions({
  resource,
  source,
}: {
  readonly resource: SessionResource
  readonly source: string | null
}) {
  const locator = resource.locator
  const remoteSource =
    locator?.startsWith('https://') === true || locator?.startsWith('http://') === true
  const localSource = locator && LOCAL_RESOURCE_PATH.test(locator) ? locator : null

  return (
    <>
      {source ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Download image"
          onClick={() => downloadResource(resource, source)}
        >
          <Download className="size-4" />
        </Button>
      ) : null}
      {remoteSource && locator ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open image source"
          onClick={() => void api.openExternal(locator)}
        >
          <ExternalLink className="size-4" />
        </Button>
      ) : null}
      {localSource ? (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open original image"
            onClick={() => void api.openPath(localSource)}
          >
            <FolderOpen className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Reveal original image"
            onClick={() => void api.revealPath(localSource)}
          >
            <FolderSearch className="size-4" />
          </Button>
        </>
      ) : null}
    </>
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
  readonly zoom: Zoom
  readonly source: string | null
  readonly onZoomChange: (zoom: Zoom) => void
  readonly onClose: () => void
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text-primary">{resource.title}</p>
        <fieldset
          aria-label="Image provenance"
          className="min-w-0 truncate border-0 p-0 text-xs text-text-tertiary"
        >
          <span>
            {index + 1} of {count}
          </span>
          <span aria-hidden="true"> · </span>
          <span>{viewerProvenance(resource)}</span>
        </fieldset>
      </div>
      <Select
        aria-label="Image zoom"
        selectSize="xs"
        value={zoom}
        onChange={(event) => {
          if (isMatching(P.union('fit', '25', '50', '100', '150', '200'), event.target.value)) {
            onZoomChange(event.target.value)
          }
        }}
      >
        <option value="fit">Fit</option>
        <option value="25">25%</option>
        <option value="50">50%</option>
        <option value="100">100%</option>
        <option value="150">150%</option>
        <option value="200">200%</option>
      </Select>
      <ViewerResourceActions resource={resource} source={source} />
      <Button variant="ghost" size="icon-sm" aria-label="Close image viewer" onClick={onClose}>
        <X className="size-4" />
      </Button>
    </header>
  )
}

export function SessionResourceViewerCatalogState({
  loading,
  errorMessage,
  onRetry,
  onClose,
}: {
  readonly loading: boolean
  readonly errorMessage: string | null
  readonly onRetry: () => void
  readonly onClose: () => void
}) {
  return (
    <ModalDialog label="Image viewer" onClose={onClose} className={VIEWER_DIALOG_CLASS}>
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
          <p className="text-sm font-medium text-text-primary">Image viewer</p>
          <Button variant="ghost" size="icon-sm" aria-label="Close image viewer" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-bg-tertiary p-8">
          {loading ? (
            <div role="status" className="flex items-center gap-2 text-sm text-text-tertiary">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              Loading this session’s images…
            </div>
          ) : (
            <div
              role="alert"
              className="max-w-sm rounded-lg border border-border bg-bg-secondary p-6 text-center"
            >
              <CircleAlert className="mx-auto mb-3 size-5 text-warning" aria-hidden="true" />
              <p className="text-sm font-medium text-text-primary">
                {errorMessage
                  ? 'Couldn’t load this session’s images.'
                  : 'This image is no longer available in this session.'}
              </p>
              {errorMessage ? (
                <p className="mt-1 text-xs text-text-tertiary">{errorMessage}</p>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                className="mt-4"
                aria-label="Retry loading session images"
                onClick={onRetry}
              >
                Retry
              </Button>
            </div>
          )}
        </div>
      </div>
    </ModalDialog>
  )
}
