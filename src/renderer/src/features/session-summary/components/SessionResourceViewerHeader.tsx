import { isMatching, P } from '@diegogbrisa/ts-match'
import type { SessionResource } from '@shared/types/session-resource'
import {
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  FolderSearch,
  MessageSquarePlus,
  Minus,
  Plus,
  Scan,
  X,
} from 'lucide-react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import { useUIStore } from '@/shell/ui-store'
import {
  preferredResourceOccurrence,
  resolveResourceBranchName,
  resourceProvenanceLabel,
  type SessionResourceBranchNames,
} from '../model/session-resource-browser'
import { type ImageViewerZoom, stepImageViewerZoom } from './SessionResourceViewerCanvas'

const LOCAL_RESOURCE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/u

function provenance(
  resource: SessionResource,
  branchNames: SessionResourceBranchNames,
  occurrence: SessionResource['occurrences'][number] | null,
) {
  const role =
    resource.isSource && resource.isOutput
      ? 'Source and output'
      : resource.isOutput
        ? 'Output'
        : 'Source'
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
  downloadUrl,
  locator,
  copying,
  addingToChat,
  onCopy,
  onAddToChat,
}: {
  readonly resource: SessionResource
  readonly source: string | null
  readonly downloadUrl: string | null
  readonly locator: string | null
  readonly copying: boolean
  readonly addingToChat: boolean
  readonly onCopy: () => void
  readonly onAddToChat: () => void
}) {
  const originalPath = locator && LOCAL_RESOURCE_PATH.test(locator) ? locator : null
  const externalSource = locator?.startsWith('http') ? locator : null
  const showToast = useUIStore((state) => state.showToast)
  const reportFailure = (cause: unknown, fallback: string) => {
    showToast(cause instanceof Error ? cause.message : fallback, 'error')
  }
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Copy image"
        disabled={source === null}
        aria-disabled={source === null || copying}
        onClick={() => {
          if (!copying) onCopy()
        }}
      >
        <Copy className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Add image to chat"
        disabled={source === null}
        aria-disabled={source === null || addingToChat}
        onClick={() => {
          if (!addingToChat) onAddToChat()
        }}
      >
        <MessageSquarePlus className="size-4" />
      </Button>
      {downloadUrl ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Download image"
          onClick={() => download(resource, downloadUrl)}
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
            onClick={() => {
              void api
                .openPath(originalPath)
                .catch((cause: unknown) =>
                  reportFailure(cause, 'Could not open the original image.'),
                )
            }}
          >
            <FolderOpen className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Reveal original ${resource.title}`}
            onClick={() => {
              void api
                .revealPath(originalPath)
                .catch((cause: unknown) =>
                  reportFailure(cause, 'Could not reveal the original image.'),
                )
            }}
          >
            <FolderSearch className="size-4" />
          </Button>
        </>
      ) : externalSource ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open image source"
          onClick={() => {
            void api
              .openExternal(externalSource)
              .catch((cause: unknown) => reportFailure(cause, 'Could not open the image source.'))
          }}
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
  downloadUrl,
  branchNames,
  activePathNodeIds,
  onZoomChange,
  copying = false,
  addingToChat = false,
  onCopy = () => {},
  onAddToChat = () => {},
  onClose,
}: {
  readonly resource: SessionResource
  readonly index: number | null
  readonly count: number
  readonly zoom: ImageViewerZoom
  readonly source: string | null
  readonly downloadUrl: string | null
  readonly branchNames: SessionResourceBranchNames
  readonly activePathNodeIds: ReadonlySet<string>
  readonly onZoomChange: (zoom: ImageViewerZoom) => void
  readonly copying?: boolean
  readonly addingToChat?: boolean
  readonly onCopy?: () => void
  readonly onAddToChat?: () => void
  readonly onClose: () => void
}) {
  const occurrence = preferredResourceOccurrence(resource, activePathNodeIds, null)
  const locator = occurrence?.locator ?? resource.locator
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text-primary">{resource.title}</p>
        <fieldset
          aria-label="Image provenance"
          className="min-w-0 truncate border-0 p-0 text-xs text-text-tertiary"
        >
          <span>
            {index === null
              ? `${String(count)} images`
              : `${String(index + 1)} of ${String(count)}`}
          </span>{' '}
          · {provenance(resource, branchNames, occurrence)}
        </fieldset>
      </div>
      <fieldset className="flex items-center gap-0.5 border-0 p-0" aria-label="Image zoom controls">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom out"
          disabled={source === null || zoom === 'fit' || zoom === '25'}
          onClick={() => onZoomChange(stepImageViewerZoom(zoom, 'out'))}
        >
          <Minus className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Fit image"
          aria-pressed={zoom === 'fit'}
          disabled={source === null}
          onClick={() => onZoomChange('fit')}
        >
          <Scan className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom in"
          disabled={source === null || zoom === '200'}
          onClick={() => onZoomChange(stepImageViewerZoom(zoom, 'in'))}
        >
          <Plus className="size-4" />
        </Button>
      </fieldset>
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
      <ResourceActions
        resource={resource}
        source={source}
        downloadUrl={downloadUrl}
        locator={locator}
        copying={copying}
        addingToChat={addingToChat}
        onCopy={onCopy}
        onAddToChat={onAddToChat}
      />
      <Button variant="ghost" size="icon-sm" aria-label="Close image viewer" onClick={onClose}>
        <X className="size-4" />
      </Button>
    </header>
  )
}
