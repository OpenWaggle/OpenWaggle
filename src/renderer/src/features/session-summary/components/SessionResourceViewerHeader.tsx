import { isMatching, P } from '@diegogbrisa/ts-match'
import type { SessionResource } from '@shared/types/session-resource'
import { Download, ExternalLink, FolderOpen, FolderSearch, X } from 'lucide-react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import {
  resolveResourceBranchName,
  resourceProvenanceLabel,
  type SessionResourceBranchNames,
} from '../model/session-resource-browser'
import type { ImageViewerZoom } from './SessionResourceViewerCanvas'

const LOCAL_RESOURCE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/u

function provenance(resource: SessionResource, branchNames: SessionResourceBranchNames) {
  const role =
    resource.isSource && resource.isOutput
      ? 'Source and output'
      : resource.isOutput
        ? 'Output'
        : 'Source'
  const occurrence = resource.occurrences.reduce<(typeof resource.occurrences)[number] | null>(
    (latest, candidate) =>
      latest === null || candidate.createdAt > latest.createdAt ? candidate : latest,
    null,
  )
  if (!occurrence) return role
  const branchName = occurrence.branchId
    ? resolveResourceBranchName(occurrence.branchId, branchNames)
    : null
  const branch = branchName ? ` · Branch ${branchName}` : ''
  return `${role} · ${resourceProvenanceLabel(
    occurrence.activity,
    occurrence.actor,
    occurrence.label,
  )}${branch}`
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
  const externalSource = resource.locator?.startsWith('http') ? resource.locator : null
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
            onClick={() => void api.openPath(originalPath).catch(() => undefined)}
          >
            <FolderOpen className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Reveal original ${resource.title}`}
            onClick={() => void api.revealPath(originalPath).catch(() => undefined)}
          >
            <FolderSearch className="size-4" />
          </Button>
        </>
      ) : externalSource ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open image source"
          onClick={() => void api.openExternal(externalSource).catch(() => undefined)}
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
  branchNames,
  onZoomChange,
  onClose,
}: {
  readonly resource: SessionResource
  readonly index: number
  readonly count: number
  readonly zoom: ImageViewerZoom
  readonly source: string | null
  readonly branchNames: SessionResourceBranchNames
  readonly onZoomChange: (zoom: ImageViewerZoom) => void
  readonly onClose: () => void
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text-primary">{resource.title}</p>
        <fieldset
          aria-label="Image provenance"
          className="min-w-0 truncate border-0 p-0 text-xs text-text-tertiary"
        >
          <span>
            {index + 1} of {count}
          </span>{' '}
          · {provenance(resource, branchNames)}
        </fieldset>
      </div>
      <Select
        aria-label="Image zoom"
        selectSize="xs"
        disabled={source === null}
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
